/* 测试任务执行平台：模块用例库 + 产品用例库 + 库间关联 + 任务执行 + 双轨审核 + 平台自有审批流程
   （账号、审批、缺陷、归档全部由本平台实现，不再依赖外部 OA 系统） */
const STORAGE_KEY = 'tmplatform.v4';

const state = {
  tab: 'todo',
  stdPage: 1, stdSize: 50,
  stdKeyword: '', stdLevel: '', stdModule: '', stdModuleKw: '', stdShowOff: false,
  selected: [],
  prodIndex: 0,
  reviewTab: 'module',
  taskPage: 1, taskSize: 50, taskKeyword: '', taskType: '', taskShowFinished: false, calendarOpen: false,
  pickShowOff: false,
  /* 从模块用例库筛选：仅显示可引用（审核通过）的用例 */
  pickOnlyRefable: true,
  calendar: { year: 2026, month: 10 },
  /* 各用例表格的列显示配置：{ std: [字段key], prod: [...], pick: [...], detail: [...] } */
  cols: {},
  /* 产品用例库左侧齐全度分析树 */
  prodTreeLevels: ['series', 'model', 'domain', 'testType', 'module', 'functionPoint', 'testPoint'],
  prodTreePath: {},
  prodTreeCollapsed: {},
  prodTreeKw: '',
  /* 执行任务列表：是否按执行人展开行 */
  execGroupByPerson: true,
  /* 用例执行页：左侧筛选树（逻辑同产品用例库，去掉产品线 / 产品型号层级） */
  execTreeLevels: ['domain', 'testType', 'module', 'functionPoint', 'testPoint'],
  execTreePath: {}, execTreeCollapsed: {}, execTreeCollapseAll: false, execTreeKw: '',
  /* 归档任务：当前年份 / 当前任务 */
  archiveYear: '', archiveTaskId: '',
  /* 数据统计：产品用例统计所选产品（'' = 全部产品） */
  statsProdModel: '',
  /* 产品用例库：构成分支图（默认隐藏 + 节点折叠状态 + 用例编号列表展开状态） */
  prodComposeOpen: false, prodComposeCollapsed: {}, prodComposeIdsOpen: {},
  /* 模块用例库：点击功能模块后按树展开（产品通用/指定产品 → 适用产品型号 → 测试类型 → 功能点 → 测试点） */
  stdTreePath: {}, stdTreeCollapsed: {}, stdModuleKw: '',
  /* 模块用例库：适用产品型号筛选（'' = 全部型号），列表 / 树计数 / 导出均按此收窄 */
  stdModel: ''
};

/* ---------- 视图状态持久化：刷新页面后停留在原页面，不再跳回首页（我的待办） ---------- */
const VIEW_KEY = 'tmplatform.view';
function saveView() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({
      tab: state.tab, reviewTab: state.reviewTab, prodIndex: state.prodIndex,
      taskId: state.currentTaskId || '', execId: (state.execCase || {}).execId || ''
    }));
  } catch (e) { }
}
function restoreView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY)) || null;
    if (!v) return;
    if (v.tab) state.tab = v.tab;
    if (v.reviewTab) state.reviewTab = v.reviewTab;
    const n = (DB.products || []).length;
    if (typeof v.prodIndex === 'number' && v.prodIndex >= 0 && v.prodIndex < n) state.prodIndex = v.prodIndex;
    /* 执行任务：恢复上次查看的任务；执行明细页若原执行任务已不存在则回到任务列表 */
    if (v.taskId && (DB.tasks || []).some(t => t.id === v.taskId)) state.currentTaskId = v.taskId;
    if (v.execId && (DB.execTasks || []).some(e => e.execId === v.execId)) {
      state.execCase = { execId: v.execId, page: 1, size: 20, filters: {}, scope: 'all', sortBy: 'default' };
    }
  } catch (e) { }
}

/* ================= 用例表格列配置（筛选列） ================= */
const COL_KEY = 'tmplatform.cols';
/* 用例领域：优先取用例自身填写值（手工字段）；历史数据缺失时回退按所属功能模块领域推导 */
const stdDomainOf = c => (c && c.domain) ? c.domain : moduleDomainOf(c && c.module, '固件');
const stdOwnerOf = c => moduleOwner(c.module) || '未指定';
/* 用例被哪些产品引用（索引实现：一次遍历产品引用关系，避免逐条用例扫描全库） */
let __refIdxProds = null, __refIdxMap = new Map();
function ensureRefIndex() {
  if (__refIdxProds === DB.products) return;
  __refIdxProds = DB.products;
  __refIdxMap = new Map();
  (DB.products || []).forEach(p => (p.refs || []).forEach(r => (r.caseIds || []).forEach(cid => {
    if (!__refIdxMap.has(cid)) __refIdxMap.set(cid, []);
    const arr = __refIdxMap.get(cid);
    if (arr.indexOf(p.model) < 0) arr.push(p.model);
  })));
}
const stdRefProductsOf = c => { ensureRefIndex(); return __refIdxMap.get(c.id) || []; };
const dash = v => (v == null || v === '' ? '—' : v);
/* 用例状态机：新增 / 正常 / 回退 / 停用（不同颜色标识） */
function statusPill(s) {
  const cls = s === '正常' ? 'success' : s === '停用' ? 'gray' : s === '回退' ? 'danger' : s === '新增' ? 'info' : 'gray';
  return pill(s, cls);
}

/* 模块用例库：用例全部字段 */
const STD_FIELDS = [
  {
    key: 'id', label: '用例编号',
    /* 取值（列表 / 详情 / 导出 / 提示标题统一走这里）：未审核通过显示「待编号」 */
    get: c => stdCaseNoLabel(c),
    cell: c => isPendingCaseId(c.id)
      ? `<span class="chip chip-warn" title="未审核通过，暂不占用正式编号（内部占位号 ${c.id}）；审核通过后按审批通过时间生成正式编号">待编号</span>`
      : c.id
  },
  { key: 'module', label: '功能模块' },
  { key: 'moduleOwner', label: '模块维护责任人', get: stdOwnerOf },
  { key: 'domain', label: '用例领域', get: stdDomainOf },
  { key: 'branch', label: '分支类型' },
  { key: 'products', label: '适用产品型号', get: stdProductsLabel, cell: stdProductsCell },
  { key: 'level', label: '用例等级' },
  { key: 'source', label: '用例来源' },
  { key: 'functionPoint', label: '功能点' },
  { key: 'testPoint', label: '测试点' },
  { key: 'testType', label: '测试类型' },
  { key: 'testProject', label: '测试项目' },
  { key: 'summary', label: '用例概述', wide: true },
  { key: 'pre', label: '前置条件', wide: true },
  { key: 'steps', label: '详细概述 / 操作步骤', wide: true },
  { key: 'input', label: '输入数据', wide: true },
  { key: 'expect', label: '预期结果 / 测试标准', wide: true },
  { key: 'remark', label: '备注', wide: true },
  { key: 'minutes', label: '手动测试时间(min)' },
  { key: 'autoFlag', label: '自动化标志' },
  { key: 'autoTool', label: '自动化工具' },
  { key: 'autoTime', label: '自动化测试时间(min)' },
  { key: 'autoUpdatedAt', label: '自动化状态更新时间' },
  { key: 'bugCount', label: 'BUG 产出数' },
  { key: 'bugIds', label: '关联 BUG', get: c => (c.bugIds || []).join('、') || '—' },
  { key: 'marketBug', label: '市场反馈 BUG' },
  { key: 'marketBugDate', label: '市场反馈时间' },
  { key: 'designer', label: '设计者' },
  { key: 'designDate', label: '设计日期' },
  { key: 'updater', label: '更新者' },
  { key: 'updateDate', label: '更新日期' },
  { key: 'refCount', label: '被产品引用数', get: c => stdRefProductsOf(c).length },
  { key: 'refProducts', label: '引用产品', wide: true, get: c => { const a = stdRefProductsOf(c); return a.length ? a.join('、') : '未被引用'; } },
  { key: 'reuse', label: '复用次数' },
  { key: 'bugId', label: 'BUG ID' },
  {
    key: 'status', label: '用例状态',
    cell: c => `${statusPill(c.status)}${c.status === '停用'
      ? ` <span class="link" onclick="openStdDetail('${c.id}')">原因</span>`
      : c.status === '新增' ? ' <span class="chip chip-warn" title="新建用例需经模块用例审核后方可入库（审核通过转为「正常」）；审核通过前不占用正式编号，显示「待编号」">待审核入库</span>' : ''}`
  },
  { key: 'disableReason', label: '停用原因', wide: true },
  { key: 'disableDate', label: '停用日期' },
  { key: 'historyLog', label: '历史 log', wide: true },
  {
    key: 'ops', label: '操作', fixed: true,
    cell: c => `<span class="link" onclick="openStdDetail('${c.id}')">查看</span>
        <span class="link" onclick="editStdCase('${c.id}')">编辑</span>
        <span class="link" onclick="toast('被 ${stdRefProductsOf(c).length} 个产品引用：${stdRefProductsOf(c).join('、') || '无'}')">关联</span>`
  }
];

const COL_SCHEMAS = {
  std: {
    label: '模块用例库', default: ['id', 'module', 'branch', 'products', 'level', 'summary', 'status', 'ops'], fields: STD_FIELDS
  },
  /* 从模块用例库筛选用例：与模块用例库同一字段集，但不含「操作」；
     默认展示全部用例字段，用户可在弹窗内「筛选列」自定义 */
  pick: {
    label: '从模块用例库筛选用例',
    default: STD_FIELDS.filter(f => f.key !== 'ops').map(f => f.key),
    keyCols: ['id', 'module', 'branch', 'products', 'level', 'functionPoint', 'summary', 'status'],
    fields: STD_FIELDS.filter(f => f.key !== 'ops')
  },
  /* 产品用例清单：引用 + 产品专属增补 */
  prod: {
    label: '产品用例清单',
    default: ['id', 'source', 'module', 'branch', 'summary', 'level', 'status', 'feedback', 'ops'],
    fields: [
      { key: 'id', label: '产品用例编号' },
      { key: 'source', label: '来源', cell: r => srcTag(r.source) },
      { key: 'module', label: '功能模块' },
      { key: 'branch', label: '分支类型' },
      { key: 'stdCaseId', label: '源模块用例' },
      { key: 'fromRef', label: '转换来源', get: r => r.fromRef || '—' },
      { key: 'fromProduct', label: '引用来源产品', get: r => (r.source === '引用产品用例' ? `引用自 ${r.fromProduct || '—'}` : '—') },
      { key: 'summary', label: '用例概述', wide: true },
      { key: 'level', label: '用例等级' },
      {
        key: 'status', label: '用例状态',
        cell: r => `${pill(r.status)}${r.source !== '引用模块库' ? ''
          : r.status === '停用' ? ' <span class="pill pill-danger">源用例已停用</span>'
            : (r.status && r.status !== '正常') ? ' <span class="pill pill-danger" title="源模块用例尚未审核通过，需先完成审核">源用例未通过审核</span>' : ''}`
      },
      { key: 'pre', label: '前置条件', wide: true },
      { key: 'steps', label: '操作步骤', wide: true },
      { key: 'input', label: '输入数据', wide: true },
      { key: 'expect', label: '预期结果', wide: true },
      { key: 'remark', label: '备注', wide: true },
      /* 用例内容字段（与模块用例库一致）：引用行只读继承源用例，增补行取自身值 */
      { key: 'caseSource', label: '用例来源' },
      { key: 'testProject', label: '测试项目' },
      { key: 'minutes', label: '手动测试时间(min)' },
      { key: 'autoFlag', label: '自动化标志' },
      { key: 'autoTool', label: '自动化工具' },
      { key: 'autoTime', label: '自动化测试时间(min)' },
      { key: 'autoUpdatedAt', label: '自动化状态更新时间' },
      { key: 'bugCount', label: 'BUG 产出数' },
      { key: 'bugIds', label: '关联 BUG', get: r => (r.bugIds || []).join('、') || '—' },
      { key: 'bugId', label: 'BUG ID' },
      { key: 'marketBug', label: '市场反馈 BUG' },
      { key: 'marketBugDate', label: '市场反馈时间' },
      { key: 'designer', label: '设计者', get: r => r.designer || '—' },
      { key: 'date', label: '日期' },
      {
        /* 回流状态三态：已回流模块库（完成）/ 已回流产品用例库（待申请回流模块库）/ 待回流确认 */
        key: 'feedback', label: '回流标准库',
        cell: r => {
          if (r.source !== '产品专属增补') return '—';
          const f = String(r.feedback || '');
          if (f.includes('已回流（模块') || f.includes('已回流模块')) return pill('已回流模块库', 'success');
          if (f.includes('已回流产品用例库')) return pill('待申请回流模块库', 'info');
          return pill(f || '待回流确认', 'warn');
        }
      },
      {
        key: 'ops', label: '操作', fixed: true,
        cell: r => (r.source === '产品专属增补'
          ? `<span class="link" onclick="openProdCaseDetail('${r.model}','${r.id}')">查看</span>
             <span class="link" onclick="applyReflow('${r.id}')">申请回流</span>
             <span class="link" onclick="editProdCase('${r.id}')">编辑</span>
             <span class="link" onclick="removeAdded('${r.id}')">删除</span>`
          : r.source === '引用产品用例'
            ? `<span class="link" onclick="openProdCaseDetail('${r.model}','${r.id}')">查看</span>
             <span class="link" onclick="removeProdRefCase('${r.fromProduct}','${r.id}')">移除引用</span>`
            : `<span class="link" onclick="openProdCaseDetail('${r.model}','${r.id}')">查看</span>
             <span class="link" onclick="editRefCase('${r.stdCaseId}')">编辑</span>
             <span class="link" onclick="removeRefCase('${r.stdCaseId}')">移除引用</span>`)
      }
    ]
  },
  /* 执行任务详情 - 用例执行明细 */
  detail: {
    label: '用例执行明细',
    default: ['seq', 'result', 'date', 'resultNote', 'auto', 'actualTime', 'executor', 'bugId', 'planDate', 'caseId', 'domain', 'level', 'source', 'testType', 'testProject', 'functionPoint', 'testPoint', 'summary', 'pre', 'steps', 'input', 'expect', 'remark', 'manualMin', 'autoFlag', 'designer'],
    fields: [
      { key: 'seq', label: '序号', get: r => r.__seq },
      { key: 'result', label: '执行结果', cell: r => resultPill(r.result) },
      { key: 'date', label: '执行日期' },
      { key: 'resultNote', label: '执行结果备注信息', wide: true },
      { key: 'auto', label: '是否自动化测试' },
      { key: 'actualTime', label: '实际测试时间(min)' },
      { key: 'executor', label: '执行人' },
      { key: 'bugId', label: 'BUG ID' },
      { key: 'planDate', label: '计划执行日期' },
      { key: 'caseId', label: '用例编号' },
      { key: 'domain', label: '用例领域' },
      { key: 'level', label: '用例等级' },
      { key: 'branch', label: '分支类型' },
      { key: 'source', label: '用例来源' },
      { key: 'testType', label: '测试类型' },
      { key: 'testProject', label: '测试项目' },
      { key: 'functionPoint', label: '功能点' },
      { key: 'testPoint', label: '测试点' },
      { key: 'summary', label: '用例概述', wide: true },
      { key: 'pre', label: '前置条件', wide: true },
      { key: 'steps', label: '详细概述 / 操作步骤', wide: true },
      { key: 'input', label: '输入数据', wide: true },
      { key: 'expect', label: '预期结果', wide: true },
      { key: 'remark', label: '备注', wide: true },
      { key: 'manualMin', label: '手动测试时间(min)' },
      { key: 'autoFlag', label: '自动化标志' },
      { key: 'designer', label: '设计人' }
    ]
  }
};

/* 产品用例字段补齐：产品用例库 / 从产品用例库筛选用例 共用（含用例分析维度字段） */
const PROD_EXTRA_FIELDS = [
  { key: 'domain', label: '用例领域' },
  { key: 'testType', label: '测试类型' },
  { key: 'functionPoint', label: '功能点' },
  { key: 'testPoint', label: '测试点' },
  { key: 'series', label: '产品系列' },
  { key: 'model', label: '所属型号' }
];
COL_SCHEMAS.prod.fields = COL_SCHEMAS.prod.fields.filter(f => f.key !== 'ops')
  .concat(PROD_EXTRA_FIELDS, COL_SCHEMAS.prod.fields.filter(f => f.key === 'ops'));
/* 从产品用例库筛选用例（弹窗）：与产品用例清单同一字段集（不含「操作」），默认展示全部字段 */
COL_SCHEMAS.pickProd = {
  label: '从产品用例库筛选用例',
  default: COL_SCHEMAS.prod.fields.filter(f => f.key !== 'ops').map(f => f.key),
  keyCols: ['id', 'source', 'module', 'summary', 'level', 'status', 'fromProduct'],
  fields: COL_SCHEMAS.prod.fields.filter(f => f.key !== 'ops')
};

/* 审核详情 - 逐条审核用例：审核环节要让任何人员都能看到被审用例的具体内容，因此字段可由查看者自选，
   且**可选范围 = 该库全部用例字段**（不含「操作」，审核单里不需要编辑入口）；默认只展示关键字段，
   避免一上来就几十列把弹窗撑爆，需要时点「全选」即可看全部字段。
   逐条结论与「全部字段」入口做成行首固定列（表格可横向滚动，行首列始终可见）。 */
const REVIEW_COL_KEY = { module: 'revstd', product: 'revprod' };
/* 审核单 / 未提交的逐条结论等渲染上下文（由 openReview 注入，供字段 cell 读取） */
let __revCtx = null, __revPending = null, __revView = null;
COL_SCHEMAS.revstd = {
  label: '审核用例内容（模块用例）',
  default: ['id', 'module', 'branch', 'products', 'level', 'summary', 'pre', 'steps', 'input', 'expect', 'status'],
  keyCols: ['id', 'module', 'level', 'summary', 'expect', 'status'],
  fields: STD_FIELDS.filter(f => f.key !== 'ops')
};
COL_SCHEMAS.revprod = {
  label: '审核用例内容（产品用例）',
  default: ['id', 'source', 'module', 'branch', 'level', 'summary', 'pre', 'steps', 'input', 'expect', 'status'],
  keyCols: ['id', 'source', 'module', 'summary', 'level', 'status'],
  fields: COL_SCHEMAS.prod.fields.filter(f => f.key !== 'ops')
};
/* 逐条结论单元格：可表决时给下拉（pass 入库 / decline 退回），否则只读展示已记录结论 */
function reviewVerdictCell(c) {
  const ctx = __revCtx || {};
  const d = (ctx.verdicts || {})[c.id];
  if (ctx.canVote) {
    return `<select class="cvsel" data-id="${c.id}"><option value="">待审核</option>`
      + `<option value="pass" ${d === 'pass' ? 'selected' : ''}>pass（入库）</option>`
      + `<option value="decline" ${d === 'decline' ? 'selected' : ''}>decline（退回）</option></select>`;
  }
  return d === 'pass' ? '<span class="chip chip-success">pass</span>' : d === 'decline' ? '<span class="chip chip-danger">decline</span>' : '—';
}

/* 用例执行页字段（含录入控件），支持按人自定义展示 */
const execTaskNow = () => DB.execTasks.find(x => x.execId === ((state.execCase || {}).execId)) || {};
/* 执行页权限：执行人员只能操作划分到自己名下的用例，他人名下用例仅可查看 */
function execRoleOf(e) {
  const me = DB.currentUser;
  const people = executorsOf(e || {});
  return {
    me, people,
    isExecutor: people.includes(me),
    /* 管理者（可操作他人名下用例）：拥有「用例管理」权限（原为最高管理员 / 一级，现随权限配置走） */
    isManager: can('manage')
  };
}
/* 行是否锁定（锁定 = 仅可查看）：任务已结束 / 非本人名下（执行人身份）/ 无任务管理权限 */
function execRowLocked(r, e) {
  if (!e || e.finished) return true;
  const { me, isExecutor, isManager } = execRoleOf(e);
  if (isExecutor) return String((r && r.executor) || '') !== me;
  return !isManager;
}
const execRo = r => (execTaskNow().finished || (r && r.__lock) ? ' disabled' : '');
COL_SCHEMAS.exec = {
  label: '用例执行页',
  default: ['result', 'resultNote', 'auto', 'actualTime', 'testProject', 'functionPoint', 'summary', 'pre', 'steps', 'input', 'expect', 'caseId', 'executor', 'ops'],
  fields: [
    {
      key: 'result', label: '执行结果', fixed: true,
      /* 未选择时保持空（不再默认 N/A）：首项为占位项「（未选择）」，选中后才会写入具体结果 */
      cell: r => `<select class="ecres${resultClass(r.result)}" data-idx="${r.__idx}"${execRo(r)} title="${r.__lock ? '仅可查看：该用例不归你执行' : (r.result ? '' : '请选择执行结果')}">`
        + `<option value=""${!r.result ? ' selected' : ''}>（未选择）</option>`
        + EXEC_RESULTS.map(x => `<option ${r.result === x ? 'selected' : ''}>${x}</option>`).join('') + '</select>'
    },
    {
      key: 'resultNote', label: '执行结果备注信息',
      cell: r => `<input class="ecnote" data-idx="${r.__idx}" value="${r.resultNote || ''}" placeholder="请输入备注信息" style="width:150px"${execRo(r)}>`
    },
    {
      key: 'auto', label: '是否自动化测试',
      cell: r => `<select class="ecauto" data-idx="${r.__idx}"${execRo(r)}>${['否', '是'].map(x => `<option ${(r.auto || '否') === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`
    },
    {
      key: 'actualTime', label: '实际测试时间(min)',
      cell: r => `<input class="ectime" data-idx="${r.__idx}" value="${r.actualTime == null ? '' : r.actualTime}" placeholder="请输入测试时间" style="width:110px"${execRo(r)}>`
    },
    { key: 'testProject', label: '测试项目' },
    { key: 'functionPoint', label: '功能点' },
    { key: 'testPoint', label: '测试点' },
    { key: 'summary', label: '用例概述', wide: true },
    { key: 'pre', label: '前置条件', wide: true },
    { key: 'steps', label: '详细步骤', wide: true },
    { key: 'input', label: '输入数据', wide: true },
    { key: 'expect', label: '预期结果', wide: true },
    { key: 'source', label: '用例来源' },
    { key: 'level', label: '用例等级' },
    { key: 'autoTime', label: '自动化测试时间(min)' },
    { key: 'caseId', label: '用例编号' },
    { key: 'executor', label: '执行人', cell: r => `<span class="chip">${r.executor || '未分配'}</span>` },
    {
      key: 'ops', label: '操作', fixed: true,
      /* 详情 / 提交Bug 对所有行可用；修改、移除仅对「本任务、未结束、且当前账号可操作」的行开放 */
      cell: r => {
        const eid = (state.execCase || {}).execId;
        const base = `<span class="link" onclick="caseDetailInExec('${eid}',${r.__idx})">详情</span>`;
        if (execTaskNow().finished) return base;
        const bug = `<span class="link" onclick="toast('请到「执行任务 → 用例执行页」勾选该用例提交缺陷（关联用例 ${r.caseId}）')">提交Bug</span>`;
        if (r.__lock) return base + bug;
        return base + bug
          + `<span class="link" onclick="editCaseInExec('${eid}',${r.__idx})" title="修改：生成新的产品专属用例，可选择是否移除本任务中的原用例">修改</span>`
          + `<span class="link" style="color:#cf3527" onclick="removeCaseInExec('${eid}',${r.__idx})" title="移除：仅从本执行任务移除，产品用例库 / 模块用例库不受影响">移除</span>`;
      }
    }
  ]
};

function loadCols() { try { return JSON.parse(localStorage.getItem(COL_KEY)) || {}; } catch (e) { return {}; } }
function saveCols() { try { localStorage.setItem(COL_KEY, JSON.stringify(state.cols)); } catch (e) { } }
/* 当前生效的列（含固定列，自动忽略已废弃字段） */
function selectedCols(key) {
  const s = COL_SCHEMAS[key];
  if (!s) return [];
  const picked = ((state.cols[key] || []).length ? state.cols[key] : s.default).filter(k => s.fields.some(f => f.key === k));
  s.fields.filter(f => f.fixed).forEach(f => { if (picked.indexOf(f.key) < 0) picked.push(f.key); });
  return picked.length ? picked : s.default.slice();
}
function colsOf(key) {
  const keys = selectedCols(key);
  return keys.map(k => COL_SCHEMAS[key].fields.find(f => f.key === k)).filter(Boolean);
}
/* 统一按列配置渲染用例表格 */
function tableByCols(key, rows, extra) {
  extra = extra || {};
  const cols = colsOf(key);
  const lead = extra.leadHead === undefined ? '' : extra.leadHead;
  const tr = `<tr>${lead}${cols.map(f => `<th${f.fixed ? ' class="th-fixed"' : ''}>${f.label}</th>`).join('')}</tr>`;
  const body = rows.map((r, i) => `<tr${extra.rowClass ? ` class="${extra.rowClass(r, i)}"` : ''}>${extra.leadCell ? extra.leadCell(r, i) : ''}${cols.map(f => {
    const content = f.cell ? f.cell(r, i) : dash(f.get ? f.get(r) : r[f.key]);
    /* compact：字段展示得很多时，长文本列限宽限高（悬停标题看全文），避免整行被撑得过高 */
    if (f.wide && extra.compact) {
      const title = String(f.get ? dash(f.get(r)) : dash(r[f.key])).replace(/"/g, '&quot;');
      return `<td class="${f.fixed ? 'td-fixed' : ''}"><div class="cell-clamp" title="${title}">${content}</div></td>`;
    }
    /* 长文本字段保留换行（pre-wrap），避免步骤/预期结果里的回车被折叠 */
    return `<td class="${f.fixed ? 'td-fixed' : ''}"${f.wide ? ' style="white-space:pre-wrap"' : ''}>${content}</td>`;
  }).join('')}</tr>`).join('');
  const span = cols.length + (lead ? 1 : 0);
  return `<table><thead>${tr}</thead><tbody>${body || `<tr><td colspan="${span}" class="empty">没有符合条件的记录</td></tr>`}</tbody></table>`;
}
/* ===== 表格列宽自适应 =====
   问题：表格是 auto 布局，列宽完全由内容决定 —— 列一多，短列（等级 / 状态 / 日期 / 数字）被压成一字一行，
   长文本列（步骤 / 预期结果 / 备注）又把整行撑到十几行高，同一页里行高忽高忽低。
   做法：按「表头 + 前若干行样本」估算每列的自然宽度，夹在 [min, max] 区间内，再用 colgroup 写死列宽 +
   table-layout:fixed；内容总宽不足容器时按比例摊开（不留白、不出现某一列特别宽），超出时整表横向滚动；
   列内文字超过 2 行截断（悬停看全文），行高稳定。
   注意：包裹单元格内容是「移动节点」而不是重建 HTML，内联 onclick 与已绑定的事件都不会丢。 */
/* ctrl：控件列的托底宽度（130 = 下拉增强层 96px 最小宽 + 单元格左右内边距，避免控件被右侧裁掉 / 出现省略号） */
const FIT_W = { min: 76, max: 320, maxWide: 300, head: 200, pad: 34, ctrl: 130, sample: 40 };
let __fitCanvas = null;
function fitTextWidth(text, font) {
  if (!text) return 0;
  if (!__fitCanvas) __fitCanvas = document.createElement('canvas').getContext('2d');
  if (__fitCanvas.font !== font) __fitCanvas.font = font;
  let w = 0;
  String(text).split('\n').forEach(line => { if (line) w = Math.max(w, __fitCanvas.measureText(line).width); });
  return w;
}
/* 单表定宽：只处理「表头一行、无合并单元格」的数据表 */
function fitTable(t) {
  if (!t || t.dataset.fitSkip !== undefined) return;
  if (t.classList.contains('detail-table') || t.classList.contains('grid-4')) return;  // 键值详情表不参与
  if (t.closest('.stat-grid')) return;                                                 // 统计卡片内小表已单独适配
  const head = t.tHead && t.tHead.rows[t.tHead.rows.length - 1];
  const body = t.tBodies[0];
  if (!head || !body) return;
  const ths = Array.from(head.cells);
  const n = ths.length;
  if (n < 2) return;
  if (ths.some(th => th.colSpan > 1 || th.rowSpan > 1)) return;
  const rows = Array.from(body.rows).filter(r => r.cells.length === n);
  const probe = (rows[0] && rows[0].cells[0]) || t;
  const cellFont = (() => { const s = getComputedStyle(probe); return `${s.fontSize} ${s.fontFamily}`; })();
  const headFont = (() => { const s = getComputedStyle(ths[0]); return `${s.fontSize} ${s.fontFamily}`; })();
  const boxCols = [];   // 纯勾选列（选择 / 启用）：固定窄列，不参与摊宽
  const widths = ths.map((th, i) => {
    const inline = parseFloat(th.style.width) || 0;   // 表头显式宽度（复选框 40px、数字列 50~80px、操作列 246px）
    const headText = (th.textContent || '').trim();
    /* 表头宽度：短的（≤150px）尽量排成一行；长的允许折两行，取「一半宽度」，避免长表头把列撑得过宽 */
    const headFull = headText ? fitTextWidth(headText, headFont) + FIT_W.pad : 0;
    const headWant = headText
      ? Math.max(FIT_W.min, Math.min(FIT_W.head, headFull <= 150 ? headFull : Math.ceil(headFull / 2) + FIT_W.pad / 2))
      : 0;
    let want = Math.max(inline, headWant);
    let wide = false, onlyBox = rows.length > 0;
    rows.slice(0, FIT_W.sample).forEach(tr => {
      const td = tr.cells[i];
      const ctrl = td.querySelector('input:not([type="checkbox"]), select, textarea');
      const txt = (td.textContent || '').trim();
      /* 只要单元格里有非勾选控件或任何文字，就不是「纯勾选列」 */
      if (ctrl || txt) onlyBox = false;
      if ((td.getAttribute('style') || '').indexOf('pre-wrap') >= 0) wide = true;
      const links = td.querySelectorAll('.link').length;
      let w;
      if (ctrl) {
        /* 输入框 / 下拉：列宽 = 控件自身宽度 + 单元格内边距，避免控件右侧被裁掉 */
        w = Math.max(FIT_W.ctrl, (parseFloat(ctrl.style.width) || 0) + FIT_W.pad);
      } else {
        w = fitTextWidth(txt, cellFont) + FIT_W.pad;
        w += Math.max(0, links - 1) * 12;                                 // 多个链接之间还有间距
        if (td.querySelector('.chip, .pill')) w += 20;                    // 徽标自带内边距
      }
      /* 操作列（多个链接）：按链接个数兜底，避免被别的列挤成「查看 编…」 */
      if (links >= 2) w = Math.max(w, 60 + links * 40);
      if (w > want) want = w;
    });
    const cap = wide ? FIT_W.maxWide : FIT_W.max;
    if (onlyBox) {
      boxCols[i] = 1;
      /* 纯勾选列：刚好放下勾选框即可，但表头文字（如「选择」）不能被压断行 */
      want = Math.max(inline, Math.min(FIT_W.min, headFull), 46);
    }
    return Math.max(onlyBox ? 40 : FIT_W.min, Math.min(cap, want));
  });
  /* 宽度收敛：内容总宽不足容器 → 按列宽比例摊开铺满（谁宽谁更宽的比例不变）；
     内容本身超出容器 → 保持各列舒适宽度，整表横向滚动（宁可滚，也不把短列压成一字一行）。 */
  const px = widths.map(w => Math.round(w));
  const sum = () => px.reduce((a, b) => a + b, 0);
  const wrap = t.parentElement;
  const avail = Math.max(0, (wrap ? wrap.clientWidth : 0) - 2);
  if (avail > 0 && sum() < avail) {
    const grow = ths.map((th, i) => i).filter(i => !boxCols[i]);
    const base = grow.reduce((a, i) => a + px[i], 0) || 1;
    const surplus = avail - sum();
    grow.forEach(i => { px[i] += surplus * (px[i] / base); });
    let over = sum() - avail;    // 摊开后的取整零头
    while (over > 0) {
      const widest = px.indexOf(Math.max.apply(null, px));
      const cut = Math.min(over, px[widest] - 40);
      if (cut <= 0) break;
      px[widest] -= cut;
      over -= cut;
    }
  } else if (avail > 0 && sum() - avail <= Math.max(60, avail * 0.08)) {
    /* 只超出一点点（估算误差 / 表头想排一行）：从最宽的几列匀出这点宽度，别为几十像素拉出滚动条 */
    let need = sum() - avail;
    px.map((w, i) => i).sort((a, b) => px[b] - px[a]).forEach(i => {
      if (need <= 0) return;
      const cut = Math.min(need, px[i] - (boxCols[i] ? 40 : FIT_W.min));
      if (cut > 0) { px[i] -= cut; need -= cut; }
    });
  }
  let cg = t.querySelector('colgroup');
  if (!cg) { cg = document.createElement('colgroup'); t.insertBefore(cg, t.firstChild); }
  if (cg.children.length !== n) cg.innerHTML = px.map(w => `<col style="width:${w}px">`).join('');
  else Array.from(cg.children).forEach((c, i) => { c.style.width = `${px[i]}px`; });
  t.classList.add('tbl-fit');
  t.style.tableLayout = 'fixed';
  t.style.width = `${px.reduce((a, b) => a + b, 0)}px`;
  /* 超过列宽的文字截断为 2 行（悬停标题看全文）：含输入控件 / 下拉的单元格不动，避免影响录入 */
  rows.slice(0, 300).forEach(tr => {
    for (let i = 0; i < n; i++) {
      const td = tr.cells[i];
      if (td.__fitClamped) continue;
      if (td.querySelector('input, select, textarea, button')) continue;
      if (td.querySelector('.cell-clamp')) { td.__fitClamped = 1; continue; }
      const txt = (td.textContent || '').trim();
      if (!txt || txt === '—' || txt.length < 6) { td.__fitClamped = 1; continue; }
      if (fitTextWidth(txt, cellFont) + FIT_W.pad <= px[i] + 6) continue;   // 放得下，不截断
      const box = document.createElement('div');
      box.className = 'cell-clamp';
      box.title = txt;
      while (td.firstChild) box.appendChild(td.firstChild);
      td.appendChild(box);
      td.__fitClamped = 1;
    }
  });
}
/* 批量适配：fitTable 是幂等的（同一内容重复执行得到同一组列宽、不会重复包裹单元格），
   所以不需要"忙碌锁"阻塞嵌套调用；即使观察回调为自身改动多跑一轮，第二轮也不会再产生变更，自然收敛。 */
let __fitTimer = 0;
function fitTables(list) {
  list.forEach(t => {
    if (!t || !t.isConnected) return;
    try { fitTable(t); } catch (e) { t.dataset.fitSkip = '1'; }
  });
}
function fitAllTables(root) {
  const scope = (root && root.nodeType === 1) ? root : document;
  const list = [];
  if (scope.tagName === 'TABLE') list.push(scope);
  if (scope.querySelectorAll) scope.querySelectorAll('table').forEach(t => list.push(t));
  fitTables(list);
}
/* 表格内容重绘（局部刷新 / 弹窗 / 切页）后自动重新适配，窗口缩放也重算一次 */
function initTableFit() {
  if (window.__fitObserver) return;
  const schedule = list => {
    clearTimeout(__fitTimer);
    __fitTimer = setTimeout(() => fitTables(list), 60);
  };
  const obs = new MutationObserver(muts => {
    const dirty = new Set();
    muts.forEach(m => {
      if (m.type !== 'childList') return;
      m.addedNodes.forEach(nd => {
        if (nd.nodeType !== 1) return;
        if (nd.tagName === 'TABLE') { dirty.add(nd); return; }
        /* 表格内部的行 / 单元格变化 → 该表需要重算 */
        const inside = nd.closest ? nd.closest('table') : null;
        if (inside) { dirty.add(inside); return; }
        /* 整块容器（弹窗、列表区）被插入 → 里面新加的表格都要算 */
        if (nd.querySelectorAll) nd.querySelectorAll('table').forEach(x => dirty.add(x));
      });
    });
    if (dirty.size) schedule(Array.from(dirty));
  });
  obs.observe(document.body, { childList: true, subtree: true });
  window.__fitObserver = obs;
  window.addEventListener('resize', () => {
    clearTimeout(__fitTimer);
    __fitTimer = setTimeout(() => fitTables(Array.from(document.querySelectorAll('table'))), 200);
  });
}
/* 列设置保存后重绘对应表格 */
function redrawForKey(key) {
  if (key === 'std') renderStd();
  else if (key === 'prod') renderProd();
  else if (key === 'exec') renderExecCases();
  else if (key === 'pick' && typeof window.__pickRedraw === 'function') window.__pickRedraw();
  else if (key === 'pickProd' && typeof window.__pickProdRedraw === 'function') window.__pickProdRedraw();
  else if (key === 'detail' && typeof window.__detailRedraw === 'function') window.__detailRedraw();
  /* 审核用例字段：重开审核详情，让新的字段设置立即生效 */
  else if (key === 'revstd' || key === 'revprod') reOpenReviewView();
  save();
}
/* 审核详情是弹窗：字段设置变化后关掉重开，等效于原地刷新（未提交的逐条结论已由 __revPending 保住） */
function reOpenReviewView() {
  if (!__revView) return;
  const v = __revView;
  closeAllModals();
  openReview(v.id, v.bucket);
}
/* 筛选列：列出该表格的全部用例字段，由用户决定展示哪些 */
window.openColPicker = function (key) {
  key = key || 'std';
  const s = COL_SCHEMAS[key];
  if (!s) return;
  const picked = new Set(selectedCols(key));
  /* 可勾选字段数与固定列数（固定列始终展示，例如审核单里的「逐条结论」「全部字段」） */
  const pickable = s.fields.filter(f => !f.fixed).length;
  const fixedN = s.fields.length - pickable;
  const fieldBox = (f) => `<label class="${f.fixed ? 'col-fixed' : ''}"><input type="checkbox" class="colchk" value="${f.key}" ${picked.has(f.key) ? 'checked' : ''} ${f.fixed ? 'disabled' : ''}> ${f.label}${f.fixed ? '（固定展示）' : ''}</label>`;
  modal(`筛选列 · ${s.label}`, `
    
    <div class="col-filter"><input id="colFilter" placeholder="🔍 搜索字段名，如：步骤 / 等级 / 备注"></div>
    <div class="pickbar">
      <span>已选 <b id="colCount">${picked.size}</b> / ${s.fields.length} 列</span>
      <span>
        <span class="link" id="colAll">全选</span>
        <span class="link" id="colMin">只留关键列</span>
        <span class="link" id="colDefault">恢复默认</span>
      </span>
    </div>
    <div class="col-picker-list" id="colList"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="saveCols">确定</button>
    </div>`);
  const syncCount = () => { $('#colCount').textContent = picked.size; };
  const renderList = () => {
    const kw = String($('#colFilter').value || '').trim().toLowerCase();
    const list = kw
      ? s.fields.filter(f => f.label.toLowerCase().includes(kw) || f.key.toLowerCase().includes(kw))
      : s.fields;
    $('#colList').innerHTML = list.length
      ? list.map(fieldBox).join('')
      : '<div class="empty" style="grid-column:1/-1">没有匹配的字段</div>';
    $$('.colchk', $('#colList')).forEach(i => i.onchange = () => { i.checked ? picked.add(i.value) : picked.delete(i.value); syncCount(); });
    syncCount();
  };
  $('#colFilter').oninput = renderList;
  $('#colAll').onclick = () => { s.fields.forEach(f => picked.add(f.key)); renderList(); };
  $('#colMin').onclick = () => { picked.clear(); (s.keyCols || s.default).forEach(k => picked.add(k)); renderList(); };
  $('#colDefault').onclick = () => { picked.clear(); (COL_SCHEMAS[key].default).forEach(k => picked.add(k)); renderList(); };
  renderList();
  $('#saveCols').onclick = () => {
    if (!picked.size) { toast('请至少保留一列'); return; }
    state.cols[key] = s.fields.map(f => f.key).filter(k => picked.has(k));
    saveCols(); closeTopModal(); redrawForKey(key);
    toast(`已保存「${s.label}」列显示设置（${state.cols[key].length} 列）`, 'success');
  };
};

let DB;

function $(sel, ctx = document) { return (ctx || document).querySelector(sel); }
function $$(sel, ctx = document) { return Array.from((ctx || document).querySelectorAll(sel)); }

/* 状态 → 胶囊样式 */
function pill(text, kind) {
  const t = text == null || text === '' ? '—' : text;
  let cls = kind;
  if (!cls) {
    if (/已通过|已回流|正常|通过|已审核/.test(t)) cls = 'success';
    else if (/审核中|待|进行|落后|未通过|退回/.test(t)) cls = /未通过|退回|落后/.test(t) ? 'danger' : 'warn';
    else if (/停用|失败|阻塞|删除/.test(t)) cls = 'danger';
    else cls = 'gray';
  }
  return `<span class="pill pill-${cls}">${t}</span>`;
}

/* ================= 数据层 ================= */
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
/* 分支类型：仅有「产品通用」「指定产品」两项。
   历史值「主分支（共性）」「次分支（型号）」在数据迁移时统一收敛，分支名不再拼接型号。 */
function normBranch(b) {
  const s = String(b == null ? '' : b).trim();
  if (s === '产品通用' || s === '指定产品') return s;
  if (!s) return '产品通用';
  if (s.indexOf('主分支') === 0 || s.indexOf('通用') >= 0 || s.indexOf('共性') >= 0) return '产品通用';
  if (s.indexOf('次分支') === 0 || s.indexOf('指定') >= 0) return '指定产品';
  return '产品通用';
}
/* 用例领域：由测试人员在用例上手工选填，固定四个选项 */
const DOMAIN_OPTIONS = ['硬件', '固件', '上位机', '软件'];
/* 用例来源：模块用例与产品专属增补共用同一套取值 */
const SOURCE_OPTIONS = ['需求', '设计', '市场问题', 'BUG 反推', '测试发散', '测试任务', '其他'];
/* 市场反馈字段的联动规则：仅当「用例来源 = 市场问题」时可填写且必填 */
const MARKET_SOURCE = '市场问题';
/* 领域下拉选项：固定四项 + 数据中已存在的历史值（如「网络」「安全」），避免编辑时被改写 */
function domainOptions(extra) { return Array.from(new Set(DOMAIN_OPTIONS.concat(extra || []))); }
/* 领域规范化：历史 / 未知值收敛到四项（网络、安全等归入「软件」） */
function normDomain(v, fallback) {
  const s = String(v == null ? '' : v).trim();
  if (DOMAIN_OPTIONS.indexOf(s) >= 0) return s;
  const map = { '网络': '软件', '安全': '软件', '上位机软件': '上位机', '云端': '上位机', 'web': '上位机', 'app': '上位机' };
  if (map[s]) return map[s];
  return fallback || '固件';
}
/* 引用组清洗：分支类型收敛后同一「模块 · 分支」可能出现重复组，合并为一组（用例编号取并集） */
function normalizeRefBranches(refs) {
  const out = [];
  (refs || []).forEach(r => {
    r.branch = normBranch(r.branch);
    r.caseIds = r.caseIds || [];
    const same = out.find(x => x.module === r.module && x.branch === r.branch);
    if (!same) { out.push(r); return; }
    r.caseIds.forEach(id => { if (same.caseIds.indexOf(id) < 0) same.caseIds.push(id); });
    if (r.date && (!same.date || r.date < same.date)) same.date = r.date;
  });
  return out;
}
/* ================= 用例数据清洗（幂等，可重复执行） =================
   清洗规则：
   ① 用例编号规范化：旧格式（UT+7 位+8 位序号等）→「UT + 设计日期(YYYYMMDD) + 5 位序号」，并级联更新所有引用
      （产品引用组、跨产品引用、专属增补的转换来源、执行任务行、审核单与逐条结论、回流去向、缺陷与市场问题关联）；
   ①′ 未通过审核的用例不占用正式编号：历史数据里「新增 / 回退」状态却已发放 UT 编号的用例，
      编号回收为「待编号」占位（PEND-日期-序号），正式编号在审核通过时发放（同一套级联引用重写）；
   ② 同一功能模块下「用例概述」重复的用例，补足区分信息（分支类型 / 测试点），保证概述可区分；
   ③ 用例状态与审核状态一致性补齐（正常 → 审核通过；新增 / 回退 → 待审核）；
   ④ 停用用例补齐停用原因与停用日期（历史数据缺失时）；
   ⑤ 执行行内容字段兜底（来源用例已不存在时给默认值），并同步来源用例的最新概述；
   ⑥ 失效回流行清理（产品专属增补已不存在的回流申请）；
   ⑦ 缺陷 / 市场问题关联的失效用例编号清空。
   有改动时写入流程日志「数据清洗」，无改动时不产生任何写入。 */
function cleanPlatformData() {
  const rep = { ids: 0, pendingNo: 0, summary: 0, reviewStatus: 0, disable: 0, execRows: 0, lineage: 0, bugs: 0, texts: 0, changed: false };
  const std = DB.stdCases || [];
  const isStdId = id => /^UT\d{13}$/.test(String(id || ''));

  /* 编号级联重写：用例编号变化时同步「产品引用组 / 跨产品引用 / 专属增补的来源 / 执行任务行 /
     审核单与逐条结论 / 回流去向 / 缺陷与市场问题关联 / 编写页草稿引用」，保证引用不断 */
  const remapStdCaseRefs = map => {
    if (!map || !map.size) return;
    const remap = id => map.get(id) || id;
    (DB.products || []).forEach(p => {
      (p.refs || []).forEach(r => { r.caseIds = (r.caseIds || []).map(remap); });
      (p.added || []).forEach(a => { if (a.fromRef) a.fromRef = remap(a.fromRef); });
      (p.prodRefs || []).forEach(pr => { pr.caseIds = (pr.caseIds || []).map(remap); });
    });
    (DB.execTasks || []).forEach(e => {
      const prefix = String(e.model || '') + '-';
      ['items', 'rows', 'execRows'].forEach(k => (e[k] || []).forEach(r => {
        const cid = String(r.caseId || '');
        if (cid) {
          const src = cid.indexOf(prefix) === 0 ? cid.slice(prefix.length) : cid;
          if (map.has(src)) r.caseId = cid.indexOf(prefix) === 0 ? prefix + map.get(src) : map.get(src);
        }
        if (r.id && map.has(r.id)) r.id = map.get(r.id);
      }));
    });
    (DB.moduleReviews || []).forEach(r => {
      r.caseIds = (r.caseIds || []).map(remap);
      if (r.caseVerdicts) {
        const nv = {};
        Object.keys(r.caseVerdicts).forEach(k => { nv[remap(k)] = r.caseVerdicts[k]; });
        r.caseVerdicts = nv;
      }
    });
    (DB.lineageProdToStd || []).forEach(l => { if (l.targetCase) l.targetCase = remap(l.targetCase); });
    (DB.bugs || []).forEach(b => { if (b.caseId) b.caseId = remap(b.caseId); });
    (DB.marketBugs || []).forEach(mb => { if (mb.caseId) mb.caseId = remap(mb.caseId); });
    (DB.draftCases || []).forEach(d => { if (d.editCase) d.editCase = remap(d.editCase); if (d.fromCase) d.fromCase = remap(d.fromCase); });
    resetStdCaseIndex();
  };

  /* ① 用例编号规范化（含级联引用）：占位号（待编号）是合法状态，不参与规范化 */
  const badIds = std.filter(c => !isStdId(c.id) && !isPendingCaseId(c.id));
  if (badIds.length) {
    const used = new Set(std.filter(c => isStdId(c.id)).map(c => c.id));
    let seq = 1;
    const nextId = ds => {
      let id;
      do { id = 'UT' + ds + String(seq).padStart(5, '0'); seq++; } while (used.has(id));
      used.add(id);
      return id;
    };
    const map = new Map();
    badIds.forEach(c => {
      const ds = /^\d{4}-\d{2}-\d{2}$/.test(c.designDate || '') ? c.designDate.replace(/-/g, '') : ymd();
      map.set(c.id, nextId(ds));
    });
    badIds.forEach(c => {
      const old = c.id;
      c.id = map.get(old);
      c.historyLog = `${c.historyLog || ''}；${today()} 数据清洗：用例编号 ${old} → ${c.id}（规范为 UT+日期+5 位序号）`;
    });
    remapStdCaseRefs(map);
    rep.ids = map.size;
  }

  /* ①′ 未通过审核的用例不占用正式编号：历史数据里已发放 UT 编号的「新增 / 回退」用例，
      编号回收为「待编号」占位（正式编号在审核通过时按审批通过时间发放），避免编号空洞浪费 */
  const recycled = std.filter(c => isStdId(c.id) && (c.status === '新增' || c.status === '回退'));
  if (recycled.length) {
    const used = new Set(std.map(c => c.id));
    const pre = PEND_PREFIX + ymd() + '-';
    let seq = 0;
    const map = new Map();
    recycled.forEach(c => {
      let id;
      do { seq++; id = pre + String(seq).padStart(4, '0'); } while (used.has(id));
      used.add(id);
      map.set(c.id, id);
    });
    recycled.forEach(c => {
      const old = c.id;
      c.id = map.get(old);
      c.historyLog = `${c.historyLog || ''}；${today()} 数据清洗：未审核通过的用例不占用正式编号，编号 ${old} 回收为「待编号」（审核通过后按审批通过时间生成）`;
    });
    remapStdCaseRefs(map);
    rep.pendingNo = map.size;
  }

  /* ② 用例概述去重（同模块下补足「分支类型 / 测试点」区分信息） */
  const groups = new Map();
  std.forEach(c => {
    const k = c.module + '||' + c.summary;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  groups.forEach(list => {
    if (list.length < 2) return;
    const usedTags = new Set();
    list.forEach(c => {
      let tag = `${c.branch} / ${c.testPoint || '通用'}`;
      if (c.summary.endsWith(`（${tag}）`)) { usedTags.add(tag); return; }
      if (usedTags.has(tag)) {
        let n = 2;
        while (usedTags.has(`${tag} · ${n}`)) n++;
        tag = `${tag} · ${n}`;
      }
      usedTags.add(tag);
      c.summary = `${c.summary}（${tag}）`;
      c.historyLog = `${c.historyLog || ''}；${today()} 数据清洗：概述补足区分信息（${tag}）`;
      rep.summary++;
    });
  });

  /* ③ 状态与审核状态一致性 */
  std.forEach(c => {
    const s = c.status || '正常';
    if ((s === '正常' || s === '停用') && !/审核通过/.test(c.reviewStatus || '')) {
      c.reviewStatus = `模块用例审核通过（历史数据，${c.updateDate || c.designDate || today()}）`;
      rep.reviewStatus++;
    } else if ((s === '新增' || s === '回退') && !String(c.reviewStatus || '').trim()) {
      c.reviewStatus = '待模块用例审核（历史数据）';
      rep.reviewStatus++;
    }
  });

  /* ④ 停用原因 / 停用日期补齐 */
  std.forEach(c => {
    if (c.status === '停用' && !String(c.disableReason || '').trim()) {
      c.disableDate = c.disableDate || c.updateDate || c.designDate || today();
      c.disableReason = '历史数据：停用时未填写原因（数据清洗补齐）';
      c.historyLog = `${c.historyLog || ''}；${c.disableDate} 数据清洗：补齐停用原因`;
      rep.disable++;
    }
  });

  /* ⑤ 执行行：同步来源用例最新概述；来源用例已不存在时补默认值，避免执行明细空白 */
  const srcOfRow = (e, r) => {
    const cid = String(r.caseId || '');
    const prefix = String(e.model || '') + '-';
    const srcId = cid.indexOf(prefix) === 0 ? cid.slice(prefix.length) : cid;
    const sc = stdCaseById(srcId);
    if (sc) return sc;
    const p = DB.products.find(x => x.model === e.model);
    if (!p) return null;
    return prodCaseRows(p).find(x => x.id === cid) || null;
  };
  (DB.execTasks || []).forEach(e => {
    execCaseRows(e).forEach(r => {
      const src = srcOfRow(e, r);
      if (src) {
        if (src.summary && r.summary !== src.summary) r.summary = src.summary;
        return;
      }
      let touched = false;
      if (!r.branch) { r.branch = '产品通用'; touched = true; }
      if (!r.level) { r.level = 'L3'; touched = true; }
      if (!r.domain) { r.domain = normDomain('', normDomain((DB.stdModules.find(m => m.name === r.module) || {}).domain, '固件')); touched = true; }
      if (!r.designer) { r.designer = '—'; touched = true; }
      if (r.manualMin == null) { r.manualMin = ''; touched = true; }
      if (!r.autoFlag) { r.autoFlag = '否'; touched = true; }
      if (r.remark == null) { r.remark = '无'; touched = true; }
      if (r.testProject == null) { r.testProject = r.module || ''; touched = true; }
      if (r.testType == null) { r.testType = '功能测试'; touched = true; }
      if (touched) rep.execRows++;
    });
  });

  /* ⑤-2 清理执行任务已下线的「投入工作量」字段（现由用例执行时间自动统计预估投入工作量） */
  (DB.execTasks || []).forEach(e => { if ('effort' in e) delete e.effort; });

  /* ⑥ 回流行字段补齐：回流分支（旧数据默认「产品通用」）、适用产品型号、回流说明 */
  (DB.lineageProdToStd || []).forEach(l => {
    if (!l.branch) l.branch = '产品通用';
    if (!Array.isArray(l.refProducts)) l.refProducts = [];
    if (l.reason == null) l.reason = '';
  });
  /* ⑥-2 失效回流行清理（指向的产品专属增补已不存在） */
  const beforeLin = (DB.lineageProdToStd || []).length;
  DB.lineageProdToStd = (DB.lineageProdToStd || []).filter(l =>
    DB.products.some(p => (p.added || []).some(a => a.id === l.prodCase)));
  rep.lineage = beforeLin - DB.lineageProdToStd.length;

  /* ⑧ 展示文案中的旧分支类型收敛（审核单标题 / 说明等历史文案） */
  const fixBranchText = s => String(s == null ? '' : s)
    .replace(/主分支（共性）/g, '产品通用')
    .replace(/次分支（[^）]*）/g, '指定产品');
  (DB.moduleReviews || []).concat(DB.productReviews || []).forEach(r => {
    ['target', 'note'].forEach(k => {
      if (r[k] && fixBranchText(r[k]) !== r[k]) { r[k] = fixBranchText(r[k]); rep.texts++; }
    });
  });
  (DB.exportRequests || []).forEach(r => {
    ['scope', 'filterDesc'].forEach(k => {
      if (r[k] && fixBranchText(r[k]) !== r[k]) { r[k] = fixBranchText(r[k]); rep.texts++; }
    });
  });

  /* ⑦ 缺陷 / 市场问题的失效用例编号清空 */
  const prodIdSet = new Set();
  (DB.products || []).forEach(p => prodCaseRows(p).forEach(r => prodIdSet.add(r.id)));
  const validCaseId = id => !!id && (!!stdCaseById(id) || prodIdSet.has(id));
  (DB.bugs || []).forEach(b => { if (b.caseId && !validCaseId(b.caseId)) { b.caseId = ''; rep.bugs++; } });
  (DB.marketBugs || []).forEach(mb => { if (mb.caseId && !validCaseId(mb.caseId)) { mb.caseId = ''; rep.bugs++; } });

  rep.changed = !!(rep.ids || rep.pendingNo || rep.summary || rep.reviewStatus || rep.disable || rep.execRows || rep.lineage || rep.bugs || rep.texts);
  return rep;
}

/* 数据迁移：补齐后续新增的字段（旧版 localStorage 数据缺少角色 / 缺陷 / 自动化等字段时自动补全） */
function migrateDB() {
  if (!DB.roles || !DB.roles.length) DB.roles = deepClone(mock.roles || []);
  /* 权限体系（可自定义）：权限项目录 / 变更记录 补齐 */
  if (!DB.permCatalog || !DB.permCatalog.length) DB.permCatalog = deepClone(mock.permCatalog || []);
  if (!DB.permAudits) DB.permAudits = deepClone(mock.permAudits || []);
  /* 权限项文案与最新版本对齐（例如「任务页」→「执行任务页」），避免本地旧数据文案滞后 */
  (function syncPermLabels() {
    const src = {};
    (mock.permCatalog || []).forEach(g => (g.items || []).forEach(i => { src[i.k] = i; }));
    (DB.permCatalog || []).forEach(g => (g.items || []).forEach(i => {
      const s = src[i.k];
      if (!s) return;
      i.label = s.label;
      if (s.desc) i.desc = s.desc;
    }));
  })();
  (DB.roles || []).forEach((r, i) => {
    if (!r.id) r.id = `R-${i + 1}`;
    if (r.builtin == null) r.builtin = ['最高管理员', '一级', '二级', '三级'].includes(r.name);
    /* 旧数据无「页面访问」权限：按原固定规则补齐（一 / 二 / 最高 全部页面，三级 审核中心 + 设置） */
    const pages = ['page.stats', 'page.std', 'page.prod', 'page.tasks', 'page.archive', 'page.reviews', 'page.perm'];
    if (!(r.perms || []).some(p => String(p).indexOf('page.') === 0)) {
      r.perms = (r.perms || []).concat(r.name === '三级' ? ['page.reviews', 'page.perm'] : pages);
    }
    /* 权限项细粒度化后补齐：edit → modify / disable / reviewCreate；task → exec / bug */
    if ((r.perms || []).includes('edit')) r.perms = r.perms.concat(['modify', 'disable', 'reviewCreate']);
    if ((r.perms || []).includes('task')) r.perms = r.perms.concat(['exec', 'bug']);
    /* 原「一级」可调整角色权限，升级后保持：补「角色与权限配置」 */
    if (['最高管理员', '一级'].includes(r.name)) r.perms = (r.perms || []).concat('roleManage');
    r.perms = Array.from(new Set(r.perms || []));
  });
  /* 当前角色必须存在于角色表中，否则回退为账号所属角色 */
  if (!DB.currentRole || !DB.roles.some(r => r.name === DB.currentRole)) DB.currentRole = roleOf(DB.currentUser);
  if (!DB.handovers) DB.handovers = deepClone(mock.handovers || []);
  if (!DB.notices) DB.notices = [];
  if (!DB.bugs) DB.bugs = mock.bugs ? deepClone(mock.bugs) : [];
  if (!DB.marketBugs) DB.marketBugs = mock.marketBugs ? deepClone(mock.marketBugs) : [];
  if (!DB.draftCases) DB.draftCases = [];
  if (!DB.exportRequests) DB.exportRequests = [];
  if (!DB.taskLogs) DB.taskLogs = deepClone(mock.taskLogs || []);
  /* 操作日志：老数据只有 {time,user,action,detail,taskId}，缺的字段（module / ts / changes）在读取时按需推断 */
  if (!Array.isArray(DB.logs)) DB.logs = [];
  if (!DB.deptMembers || !DB.deptMembers.length) DB.deptMembers = deepClone(mock.deptMembers || []);
  /* 历史任务归档：任务编号日期早于 2026-09 的任务视为已完结并归档（平台内自动归档） */
  (DB.tasks || []).forEach(t => {
    const d = taskDateOf(t);
    if (d !== '—' && d < '2026-09-01') { t.finished = '是'; t.archivedAt = t.archivedAt || d; }
  });
  /* 用例字段补齐（兼容旧数据：自动化 / 状态 / BUG 产出 / 市场反馈） */
  (DB.stdCases || []).forEach(ensureStdCaseFields);
  /* 产品间引用容器（旧数据补齐） */
  (DB.products || []).forEach(p => {
    p.refs = p.refs || [];
    p.added = p.added || [];
    p.prodRefs = (p.prodRefs || []).filter(pr => pr && pr.fromModel && pr.fromModel !== p.model);
  });
  /* 产品用例编号前段：PC- → 产品名称（型号），并同步库间关联与执行任务中的引用 */
  (DB.products || []).forEach(p => (p.added || []).forEach((a, i) => {
    const id = String(a.id || '');
    if (id.indexOf('PC-') !== 0) return;
    const m = id.match(/-A(\d+)$/);
    a.id = prodCaseNo(p.model, 'A' + (m ? m[1] : String(i + 1).padStart(2, '0')));
  }));
  (DB.lineageProdToStd || []).forEach(l => {
    const id = String(l.prodCase || '');
    if (id.indexOf('PC-') !== 0) return;
    const m = id.match(/-A(\d+)$/);
    l.prodCase = prodCaseNo(l.product || '', 'A' + (m ? m[1] : '01'));
  });
  (DB.execTasks || []).forEach(e => execCaseRows(e).forEach(r => {
    const id = String(r.caseId || '');
    if (id.indexOf('PC-') === 0) r.caseId = prodCaseNo(e.model || '', id.slice(3));
  }));
  /* 数据清洗：移除已废弃的「模块编号」字段（功能模块不再维护编号，用例侧不再展示 / 导出） */
  (DB.stdModules || []).forEach(m => { delete m.code; });
  (DB.stdCases || []).forEach(c => { delete c.moduleCode; });
  (DB.products || []).forEach(p => (p.added || []).forEach(a => { delete a.moduleCode; }));
  /* 数据清洗：移除已废弃的产品引用「引用版本」字段（模块用例库无版本概念，该字段无实际作用） */
  (DB.products || []).forEach(p => (p.refs || []).forEach(r => { delete r.version; }));
  /* 数据清洗：分支类型收敛为「产品通用 / 指定产品」——模块用例、产品引用、草稿、执行任务明细一并转换 */
  (DB.stdCases || []).forEach(c => {
    c.branch = normBranch(c.branch);
    /* 用例领域：历史数据固化模块推导值（收敛到「硬件 / 固件 / 上位机 / 软件」四项），此后由测试人员手工维护 */
    c.domain = normDomain(c.domain, normDomain((DB.stdModules.find(m => m.name === c.module) || {}).domain, '固件'));
    /* 产品通用 = 各产品共用实现，不挂具体适用产品型号；指定产品的型号一律拆成一个个独立产品 */
    c.refProducts = c.branch === '产品通用' ? [] : splitModels(c.refProducts);
  });
  /* 产品专属增补用例的领域同样收敛到四项 */
  (DB.products || []).forEach(p => (p.added || []).forEach(a => {
    a.domain = normDomain(a.domain, normDomain((DB.stdModules.find(m => m.name === a.module) || {}).domain, '固件'));
  }));
  /* 数据自愈：用例（含产品专属增补用例）里存在、但模块划分表缺失的功能模块自动补登——
     左侧「模块用例库结构」是按模块划分表渲染的，缺失时会出现「用例在库、结构树里看不到该模块」 */
  DB.stdModules = DB.stdModules || [];
  const healMods = [];
  const healModule = (name, domain) => {
    const n = String(name == null ? '' : name).trim();
    if (!n || healMods.indexOf(n) >= 0 || DB.stdModules.some(m => m.name === n)) return;
    if ((DB.delModules || []).indexOf(n) >= 0) return;   /* 已被手工删除的模块不自动补回 */
    healMods.push(n);
    DB.stdModules.push({ name: n, domain: domain || '固件', owner: '' });
  };
  (DB.stdCases || []).forEach(c => healModule(c.module, c.domain));
  (DB.products || []).forEach(p => (p.added || []).forEach(a => healModule(a.module, a.domain)));
  if (healMods.length) log('模块划分表补登', `以下功能模块在用例中存在但模块划分表缺失，已自动补登（责任人待设置）：${healMods.join('、')}`);
  (DB.products || []).forEach(p => { p.refs = normalizeRefBranches(p.refs); });
  (DB.draftCases || []).forEach(c => { if (c.branch) c.branch = normBranch(c.branch); });
  /* 执行任务的行对象可能在 items / rows / execRows 三处（渲染时会合并为 rows），统一清洗 */
  (DB.execTasks || []).forEach(e => {
    ['items', 'rows', 'execRows'].forEach(k => (e[k] || []).forEach(it => { if (it.branch) it.branch = normBranch(it.branch); }));
  });
  /* 列显示方案清洗：从本地保存的方案中去掉「模块编号」「引用版本」列（含当前内存副本） */
  try {
    const cols = JSON.parse(localStorage.getItem(COL_KEY)) || {};
    Object.keys(cols).forEach(k => {
      if (Array.isArray(cols[k])) cols[k] = cols[k].filter(x => x !== 'moduleCode' && x !== 'refVersion' && x !== 'sync');
    });
    localStorage.setItem(COL_KEY, JSON.stringify(cols));
  } catch (e) { }
  if (state.cols) Object.keys(state.cols).forEach(k => {
    if (Array.isArray(state.cols[k])) state.cols[k] = state.cols[k].filter(x => x !== 'moduleCode' && x !== 'refVersion' && x !== 'sync');
  });
  /* ---------- 用例数据清洗（幂等）：编号规范化 / 概述去重 / 状态补齐 / 失效引用清理 ---------- */
  const cleanRep = cleanPlatformData();
  if (cleanRep.changed) {
    log('数据清洗', `用例编号规范化 ${cleanRep.ids} 条｜未通过用例编号回收 ${cleanRep.pendingNo} 条｜概述补足区分信息 ${cleanRep.summary} 条｜审核状态补齐 ${cleanRep.reviewStatus} 条｜`
      + `停用原因补齐 ${cleanRep.disable} 条｜执行行字段补齐 ${cleanRep.execRows} 条｜失效回流行清理 ${cleanRep.lineage} 条｜`
      + `失效缺陷关联清理 ${cleanRep.bugs} 条｜历史文案收敛 ${cleanRep.texts} 条`);
  }
  save();
}
/* 执行结果默认值迁移（一次性）：历史版本会把「未选择」写成 N/A，与「N/A（不适用）」混淆。
   这里把历史 N/A 还原为未选择（空），执行进度统计口径不变（N/A 与空在 countRows 里都算未执行）。
   迁移只执行一次，之后用户主动选择的 N/A 不受影响。
   注意：必须在演示数据合并（mergeCanfd）之后调用，才能覆盖历史执行记录里的历史 N/A。 */
function migrateEmptyExecResult() {
  if (DB.resultEmptyMigrated) return;
  let n = 0;
  (DB.execTasks || []).forEach(t => ['items', 'rows', 'execRows'].forEach(k => (t[k] || []).forEach(r => {
    if (r.result === 'N/A') { r.result = ''; n++; }
  })));
  DB.resultEmptyMigrated = true;
  if (n) log('执行结果口径迁移', `历史「N/A」不再视为默认值，已把 ${n} 条执行行还原为「未选择」（执行进度统计口径不变）`);
  save();
}
function ensureStdCaseFields(c, i) {
  if (!c.source) c.source = '需求';
  if (!c.designDate) c.designDate = '2026-04-16';
  if (!c.updater) c.updater = c.designer;
  if (!c.updateDate) c.updateDate = '2026-09-28';
  if (!c.testType) c.testType = '功能测试';
  if (!c.testProject) c.testProject = c.module;
  if (c.reuse == null) c.reuse = (i % 5) + 1;
  if (c.autoFlag == null) c.autoFlag = i % 4 === 0 ? '是' : '否';
  if (c.autoFlag === '是') {
    if (!c.autoTool) c.autoTool = 'AUTO-RobotFramework';
    if (!c.autoTime || c.autoTime === '—') c.autoTime = String((i % 9) + 2);
    if (!c.autoUpdatedAt) c.autoUpdatedAt = '2026-09-28';
  } else {
    if (!c.autoTool) c.autoTool = '—';
    if (c.autoTime == null) c.autoTime = '—';
    c.autoUpdatedAt = c.autoUpdatedAt || '—';
  }
  if (!c.status) c.status = '正常';
  if (c.bugId == null) c.bugId = (c.bugIds && c.bugIds[0]) || '—';
  if (c.bugCount == null) c.bugCount = c.bugIds ? c.bugIds.length : (c.bugId && c.bugId !== '—' ? 1 : 0);
  if (!c.bugIds) c.bugIds = c.bugId && c.bugId !== '—' ? [c.bugId] : [];
  if (c.marketBug == null) c.marketBug = '';
  if (c.marketBugDate == null) c.marketBugDate = '';
  if (!c.historyLog) c.historyLog = `${c.designDate} 新增；${c.updateDate} 修订`;
  if (c.log == null) c.log = `首次创建：新增（${c.designer}）`;
}
/* ================= 本地缓存 + 服务端同步 =================
   保存策略：先写本地缓存（离线也不丢），再以 500ms 防抖推送到服务端；
   推送带版本号做乐观锁，版本冲突时用「本次改动 vs 上次同步快照」做三方合并后重试，
   避免多人同时使用互相覆盖。 */
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); } catch (e) { }
  schedulePush();
}
function load() { try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

let SESSION = null;   /* 当前登录账号 { name, role } */
const SYNC = { version: 0, base: null, timer: 0, pushing: false, dirty: false, online: true, pullTimer: 0 };
const ENTITY_KEYS = ['id', 'execId', 'caseId', 'code', 'model', 'slot', 'name'];
function entityKey(o) {
  if (!o || typeof o !== 'object') return '';
  for (let i = 0; i < ENTITY_KEYS.length; i++) {
    const v = o[ENTITY_KEYS[i]];
    if (v != null && v !== '') return String(v);
  }
  try { return JSON.stringify(o); } catch (e) { return ''; }
}
function stateClone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }
/* 推给服务端的状态：去掉与「谁在登录」相关的字段（那是每个会话自己的） */
function stateForServer() {
  const c = stateClone(DB) || {};
  delete c.currentUser;
  delete c.currentRole;
  return c;
}
/* 计算「本地相对上次同步快照」的改动：数组按元素主键比对，对象整体比对 */
function diffOps(base, local) {
  const ops = { set: {}, del: {} };
  const keys = new Set(Object.keys(base || {}).concat(Object.keys(local || {})));
  keys.forEach(k => {
    const b = (base || {})[k];
    const l = (local || {})[k];
    if (Array.isArray(l)) {
      const bm = new Map((Array.isArray(b) ? b : []).map(it => [entityKey(it), it]));
      const lm = new Map(l.map(it => [entityKey(it), it]));
      lm.forEach((it, key) => {
        const old = bm.get(key);
        if (!old || JSON.stringify(old) !== JSON.stringify(it)) (ops.set[k] = ops.set[k] || []).push(it);
      });
      bm.forEach((it, key) => { if (!lm.has(key)) (ops.del[k] = ops.del[k] || []).push(key); });
    } else if (l && typeof l === 'object') {
      if (JSON.stringify(l) !== JSON.stringify(b)) ops.set[k] = l;
    } else if (JSON.stringify(l) !== JSON.stringify(b)) {
      ops.set[k] = l;
    }
  });
  return ops;
}
/* 把本地改动合并到服务端最新状态上（同一条数据以本地为准，其他成员的新增保留） */
function mergeState(server, local, base) {
  const merged = stateClone(server) || {};
  const ops = diffOps(base, local);
  Object.keys(ops.set).forEach(k => {
    const v = ops.set[k];
    if (Array.isArray(v)) {
      const arr = Array.isArray(merged[k]) ? merged[k].slice() : [];
      const idx = new Map(arr.map((it, i) => [entityKey(it), i]));
      v.forEach(it => {
        const key = entityKey(it);
        if (idx.has(key)) arr[idx.get(key)] = it; else { idx.set(key, arr.length); arr.push(it); }
      });
      merged[k] = arr;
    } else {
      merged[k] = v;
    }
  });
  Object.keys(ops.del).forEach(k => {
    if (!Array.isArray(merged[k])) return;
    const set = new Set(ops.del[k]);
    merged[k] = merged[k].filter(it => !set.has(entityKey(it)));
  });
  return merged;
}
function schedulePush() {
  if (!SESSION || !API.getToken()) return;
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(pushState, 500);
}
async function pushState() {
  if (!SESSION || !API.getToken()) return;
  if (SYNC.pushing) { SYNC.dirty = true; return; }
  SYNC.pushing = true;
  const snapshot = stateForServer();
  try {
    let r = await API.putState(SYNC.version, snapshot);
    if (r && r.conflict) {
      /* 别人先一步保存了：把本次改动合并到服务端最新状态后重试一次 */
      const merged = mergeState(r.state, snapshot, SYNC.base);
      const r2 = await API.putState(r.version, merged);
      if (r2 && r2.conflict) throw new Error('同步冲突，请刷新页面后重试');
      SYNC.version = r2.version;
      SYNC.base = stateClone(merged);
      adoptRemote(merged, r2.version, false);
      toast('已与其他成员同时提交的改动合并', 'success');
    } else {
      SYNC.version = r.version;
      SYNC.base = stateClone(snapshot);
    }
    if (!SYNC.online) { SYNC.online = true; markOnline(); }
  } catch (e) {
    if (e.unauthorized) { showLogin('登录已过期，请重新登录'); return; }
    if (e.offline) { SYNC.online = false; markOffline(); }
    console.warn('[sync] 保存失败：', e.message);
  } finally {
    SYNC.pushing = false;
    if (SYNC.dirty) { SYNC.dirty = false; schedulePush(); }
  }
}
/* 采用服务端状态：保留本会话的登录身份，必要时重绘 */
function adoptRemote(state, version, rerender) {
  const keepUser = DB.currentUser;
  if (!state) return;
  DB = state;
  DB.currentUser = keepUser || (SESSION && SESSION.name) || '';
  DB.currentRole = roleOf(DB.currentUser) || (SESSION && SESSION.role) || DB.currentRole;
  SYNC.version = version;
  SYNC.base = stateClone(state);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DB)); } catch (e) { }
  if (rerender) redrawKeepView();
}
/* 空闲时拉取最新数据（有弹窗或正在输入时不打断） */
async function pullIfIdle() {
  if (!SESSION || SYNC.pushing || !API.getToken()) return;
  if (document.querySelector('.modal-backdrop')) return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
  try {
    const r = await API.getState();
    if (!r || !r.state) return;
    if (r.version !== SYNC.version) {
      adoptRemote(r.state, r.version, true);
      markOnline();
      toast('已载入其他成员的最新数据', 'success');
    }
  } catch (e) { /* 网络抖动忽略，下次再试 */ }
}
function startAutoPull() {
  clearInterval(SYNC.pullTimer);
  SYNC.pullTimer = setInterval(pullIfIdle, 20000);
}
/* 顶栏同步状态标记 */
function markOffline() {
  const el = document.querySelector('[data-sync-badge]');
  if (el) { el.textContent = '离线（本地已保存）'; el.title = '与服务器断开：数据已存到本机，恢复连接后自动补传'; }
}
function markOnline() {
  const el = document.querySelector('[data-sync-badge]');
  if (el) { el.textContent = '已同步'; el.title = '数据已保存到服务器'; }
}
/* 空白数据（从头开始验证）：只保留平台基础数据（角色 / 权限项 / 部门成员 / 账号），
   业务数据（功能模块、用例、产品、任务、执行、审核、回流、缺陷、日志等）全部清空 */
function blankDB() {
  const d = deepClone(mock);
  d.stdModules = [];
  d.stdCases = [];
  d.stdStats = [];
  d.products = [];
  d.productMembers = {};
  d.tasks = [];
  d.execTasks = [];
  d.taskLogs = [];
  d.bugs = [];
  d.marketBugs = [];
  d.moduleReviews = [];
  d.productReviews = [];
  d.lineageProdToStd = [];
  d.exportRequests = [];
  d.draftCases = [];
  d.permAudits = [];
  d.handovers = [];
  d.notices = [];
  d.logs = [];
  delete d.datasetMeta;
  delete d.canfd;
  delete d.taskDetail;
  delete d.executedTasks;
  delete d.cases;
  delete d.execRows;
  delete d.stdCaseDetail;
  delete d.task;
  d.blank = true;
  d.currentUser = mock.currentUser || 'admin';
  const role = (d.roles || []).find(r => (r.users || []).includes(d.currentUser));
  d.currentRole = (role && role.name) || ((d.roles || [])[0] || {}).name || '最高管理员';
  return d;
}
/* 清空平台数据：清空全部业务数据并同步到服务端（保留账号 / 角色 / 权限基础数据） */
window.clearAllData = function () {
  if (!can('manage')) { toast('当前账号无「清空数据」权限', 'error'); return; }
  confirmModal('清空平台数据',
    `<p>将删除平台内<b>全部业务数据</b>：功能模块划分表、模块用例、产品与产品用例、任务与执行记录、审核单、回流记录、缺陷、导入导出申请、流程日志。</p>
     <p>仅保留<b>账号、角色与权限</b>基础数据。清空操作会立即写入服务器，对所有使用者生效。</p>
     <p style="color:#c0392b">该操作不可撤销，请确认已无需要保留的数据。</p>`,
    () => {
      DB = blankDB();
      /* 清空动作本身也要留痕：日志随数据一起被清空，因此在清空后的空白库里补记一条 */
      log('清空平台数据', '清空全部业务数据（功能模块 / 用例 / 产品 / 任务与执行 / 审核 / 回流 / 缺陷 / 申请），仅保留账号与权限基础数据', '', { module: '系统' });
      save();
      try { localStorage.removeItem(VIEW_KEY); } catch (e) { }
      state.prodIndex = 0;
      state.selected = [];
      state.execCase = null;
      state.currentTaskId = '';
      state.stdModule = '';
      state.stdLevel = '';
      state.stdModel = '';
      state.tab = 'todo';
      resetStdCaseIndex();
      closeTopModal();
      renderApp();
      toast('已清空平台数据，可从空白开始验证', 'success');
    });
};

const p2 = n => String(n).padStart(2, '0');
function today() { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
function ymd() { return today().replace(/-/g, ''); }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
/* 从指定日期起加 N 个工作日（跳过周末），用于审核期限 */
function addWorkDays(dateStr, days) {
  const d = new Date((dateStr || today()) + 'T00:00:00');
  let n = 0;
  while (n < days) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) n++;
  }
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}
/* 距审核期限剩余天数（用于企业微信提醒节点 48/24/12 小时） */
function daysToDeadline(deadline) {
  const a = new Date((deadline || today()) + 'T00:00:00').getTime();
  const b = new Date(today() + 'T00:00:00').getTime();
  return Math.round((a - b) / 86400000);
}
/* 审核期限提示：48/24/12 小时节点企业微信提醒 */
function deadlineHint(r) {
  if (!isOpenReview(r)) return `已于 ${r.archivedAt || today()} 封闭，不再提醒`;
  const left = daysToDeadline(r.deadline);
  const node = left > 2 ? '距截止 48 小时节点' : left > 1 ? '距截止 24 小时节点' : left > 0 ? '距截止 12 小时节点' : '已超期';
  return `截止 ${r.deadline}（剩余 ${left} 天，${node}）→ 企业微信消息推送审批人：${(r.participants || []).join('、') || '—'}`;
}
function nowStr() { const d = new Date(); return `${today()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; }

/* ================= 操作日志（审计留痕） =================
   一条日志的结构：
   { time, ts, user, role, module, action, objType, objId, detail, changes, taskId, count, mergeKey }
   - module   ：模块标签（用例库 / 产品用例库 / 任务 / 执行 / 审核 / 权限 / 导入导出 / 系统 / 其他），
                调用方可用 opts.module 指定，未指定时按 action 关键字推断（logModuleOf）；
   - changes  ：字段级前后值 [{ field, from, to }]，同时拼进 detail 文本，页面上可直接读、也能导出核对；
   - mergeKey ：同一人 + 同一对象 + 同一字段在 LOG_MERGE_MS 内的连续修改合并为一条（count 记次数），
                避免执行结果备注这类高频输入把日志刷屏，同时保证「第一次的原值」不丢。 */
const LOG_MAX = 5000;                 /* 本机最多保留条数（超出丢弃最旧的），防止 localStorage 无限膨胀 */
const LOG_MERGE_MS = 90000;           /* 合并窗口：同一 mergeKey 90 秒内合并 */
const LOG_MODULE_RULES = [
  [/角色|权限|移交|账号|演示角色/, '权限'],
  [/执行结果|执行任务|工时|Bug|BUG|发散|分配|移交用例|批量标记/, '执行'],
  [/任务/, '任务'],
  [/产品|回流|引用/, '产品用例库'],
  [/模块用例|用例审核|编写|草稿|回退用例|功能模块/, '用例库'],
  [/审核/, '审核'],
  [/导入|导出/, '导入导出'],
  [/清空|重置|演示数据|数据清洗|迁移|口径/, '系统']
];
function logModuleOf(action) {
  const a = String(action || '');
  const hit = LOG_MODULE_RULES.find(([re]) => re.test(a));
  return hit ? hit[1] : '其他';
}
/* 日志所属模块（兼容旧数据：早期日志只有 action，没有 module 字段） */
function logModuleOfRecord(l) { return (l && l.module) || logModuleOf(l && l.action); }
function log(action, detail, taskId, opts) {
  const o = opts || {};
  DB.logs = DB.logs || [];
  const rec = {
    time: nowStr(), ts: Date.now(), user: DB.currentUser, role: DB.currentRole || '',
    module: o.module || logModuleOf(action),
    action: String(action || ''),
    objType: o.objType || '', objId: o.objId || '',
    detail: detail == null ? '' : String(detail),
    changes: (o.changes && o.changes.length) ? o.changes : null,
    taskId: taskId || o.taskId || ''
  };
  if (o.mergeKey) {
    const last = DB.logs[0];
    if (last && last.mergeKey === o.mergeKey && rec.ts - (last.ts || 0) < LOG_MERGE_MS) {
      const prev = last.changes || [];
      /* 合并时保留「第一次修改前的原值」，只把现值更新为最新一次，保证追溯链完整 */
      const merged = (rec.changes || []).map((c, i) => ({ field: c.field, from: prev[i] ? prev[i].from : c.from, to: c.to }));
      last.time = rec.time;
      last.ts = rec.ts;
      last.changes = merged.length ? merged : rec.changes;
      last.detail = merged.length ? (o.mergePrefix || '') + changesText(merged, o.max || 40) : rec.detail;
      last.count = (last.count || 1) + 1;
      save();
      return last;
    }
    rec.mergeKey = o.mergeKey;
  }
  DB.logs.unshift(rec);
  if (DB.logs.length > LOG_MAX) DB.logs.length = LOG_MAX;
  save();
  return rec;
}
/* ---------- 字段级差异（全平台通用） ---------- */
/* 比较用的归一值：数组排序拼接，字符串去首尾空白 */
function logNormVal(v) {
  if (Array.isArray(v)) return v.slice().sort().join('、');
  return String(v == null ? '' : v).trim();
}
/* diffFields(before, after, [[key, 标签], ...]) → [{ field, from, to }]（无变化返回空数组） */
function diffFields(before, after, fields) {
  const out = [];
  (fields || []).forEach(([k, label]) => {
    const b = (before || {})[k], a = (after || {})[k];
    if (logNormVal(b) === logNormVal(a)) return;
    out.push({ field: label, from: logValueText(b), to: logValueText(a) });
  });
  return out;
}
/* 变更数组 → 一行文本：`字段「原值」→「现值」`，多项以「；」分隔（日志 detail / 导出共用） */
function changesText(changes, max) {
  return (changes || []).map(c => `${c.field}「${briefLogText(c.from, max || 60)}」→「${briefLogText(c.to, max || 60)}」`).join('；');
}
/* 记录「某次编辑改了哪些字段」：自动拼 detail；返回日志对象（无变化时记一条「无变更」便于确认操作发生过） */
function logEdit(action, before, after, fields, opts) {
  const o = opts || {};
  const changes = diffFields(before, after, fields);
  const head = o.head ? `${o.head}｜` : '';
  const body = changes.length ? changesText(changes, o.max) : (o.tail || '（无字段变化）');
  return log(action, head + body + (changes.length && o.tail ? '；' + o.tail : ''), o.taskId, Object.assign({}, o, { changes }));
}
function nextId(prefix, list) {
  let max = 0;
  list.forEach(x => { const m = String(x.id || '').match(/(\d+)$/); if (m) max = Math.max(max, +m[1]); });
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
function nextStdCaseId() {
  let max = 0;
  DB.stdCases.forEach(c => { const m = String(c.id || '').match(/^UT\d{8}(\d+)$/); if (m) max = Math.max(max, +m[1]); });
  return 'UT' + ymd() + String(max + 1).padStart(5, '0');
}
/* ---------- 待编号占位（未审核通过的用例不占用正式编号） ----------
   正式编号（UT + 审批通过日期 + 5 位序号）只在「审核通过」时发放：
   否则每次提交、回退、重新提交都会烧掉一个序号，形成永久空洞（编号浪费）。
   未通过审核的用例用占位号作内部唯一标识（列表 / 详情 / 导出统一显示为「待编号」），
   审核通过时才把 id 换成正式编号（见 reviewConclude）。 */
const PEND_PREFIX = 'PEND-';
function isPendingCaseId(id) { return String(id == null ? '' : id).indexOf(PEND_PREFIX) === 0; }
function nextPendingCaseId() {
  const pre = PEND_PREFIX + ymd() + '-';
  let max = 0;
  (DB.stdCases || []).forEach(c => {
    const s = String(c.id == null ? '' : c.id);
    if (s.indexOf(pre) !== 0) return;
    const m = s.match(/^PEND-\d{8}-(\d+)$/);
    if (m) max = Math.max(max, +m[1]);
  });
  return pre + String(max + 1).padStart(4, '0');
}
/* 编号展示：未审核通过的用例显示「待编号」（正式编号在审核通过时生成） */
function stdCaseNoLabel(c) { return (c && isPendingCaseId(c.id)) ? '待编号' : (c ? c.id : ''); }
/* 编号列表文案：整批都是待编号用例时折叠为「待编号 ×N」，避免一串重复的「待编号」 */
function stdCaseNoListLabel(ids) {
  const list = (ids || []).map(id => DB.stdCases.find(c => c.id === id)).filter(Boolean);
  if (list.length && list.length === (ids || []).length && list.every(c => isPendingCaseId(c.id))) return `待编号 ×${list.length}`;
  return (ids || []).map(id => isPendingCaseId(id) ? '待编号' : id).join('、');
}
/* 模块用例的适用产品展示：「产品通用」为各产品共性场景，不限型号 */
const MODEL_ANY_LABEL = '通用（不限型号）';
/* 「适用产品型号」按分隔符拆成一个个独立产品：支持「、」逗号 分号 竖线 斜杠（/ ／）。
   型号名本身可能含空格（如「USR-G780 V2」），故不按空格拆分。
   拆分后每个型号都是独立单位 —— 筛选候选、筛选匹配、产品引用池、列表展示四处口径一致 */
const MODEL_SEP = /[、,，;；|/／]+/;
function splitModels(v) {
  const raw = Array.isArray(v) ? v : [v];
  const out = [];
  raw.forEach(x => String(x == null ? '' : x).split(MODEL_SEP).forEach(s => {
    const t = s.trim();
    if (t && t !== MODEL_ANY_LABEL && out.indexOf(t) < 0) out.push(t);
  }));
  return out;
}
/* 文本取值（详情纯文本 / Excel 导出 / 历史 log）：一个个型号用「、」连接 */
function stdProductsLabel(c) {
  const ms = splitModels(c && c.refProducts);
  return ms.length ? ms.join('、') : MODEL_ANY_LABEL;
}
/* 列表展示：按分隔符拆成一个个产品标签；筛选区勾选了型号时，命中的标签点亮 */
function stdProductsCell(c) {
  const ms = splitModels(c && c.refProducts);
  if (!ms.length) return `<span class="chip chip-model is-any" title="产品通用：各产品共用同一实现，不限型号">${MODEL_ANY_LABEL}</span>`;
  const sel = asList(state.stdModel);
  return ms.map(m => {
    const hit = sel.length > 0 && sel.indexOf(m) >= 0;
    const tip = sel.length ? (hit ? '命中筛选型号：' : '未命中筛选型号：') : '适用产品型号：';
    return `<span class="chip chip-model${hit ? ' is-hit' : ''}" title="${tip}${m}">${m}</span>`;
  }).join('');
}
/* 筛选条件统一归一化为数组：筛选区下拉支持多选（['L1','L2']），
   同时兼容旧视图持久化的字符串（'L1'）与空值；'' / '全部' / null 一律视为「不限」 */
function asList(v) {
  if (v == null || v === '' || v === '全部') return [];
  const arr = Array.isArray(v) ? v : String(v).split('、');
  return arr.map(x => String(x == null ? '' : x).trim()).filter(x => x && x !== '全部');
}
/* 下拉当前选中值（直接读 DOM，不依赖 state）：多选下拉返回数组、未选 = []；
   单选下拉未选（值为 ''）= []。供弹窗内临时筛选与「重置筛选」使用 */
function selValues(el) {
  if (!el) return [];
  return Array.from(el.selectedOptions || []).map(o => o.value).filter(v => v !== '');
}
/* 用例是否适用所选产品型号（多选任一命中即适用）：不传型号即不过滤；
   「产品通用」为各产品共用实现，任何型号都适用；「指定产品」按用例声明的适用产品型号判断 */
function moduleAppliesModel(c, model) {
  const list = asList(model);
  if (!list.length) return true;
  if (!c) return false;
  if (c.branch === '产品通用') return true;
  const rp = splitModels(c.refProducts);
  return list.some(m => rp.indexOf(m) >= 0);
}
/* 「适用产品型号」筛选项：产品型号 ∪ 用例声明的适用产品型号（避免漏掉产品表里还没有的型号）；
   每项都按分隔符拆成单个产品，不出现「A/B」这类合并串 */
function stdModelOptions() {
  const out = [];
  const push = m => { const s = String(m == null ? '' : m).trim(); if (s && out.indexOf(s) < 0) out.push(s); };
  (DB.products || []).forEach(p => push(p.model));
  (DB.stdCases || []).forEach(c => splitModels(c.refProducts).forEach(push));
  return out.sort();
}
/* 产品用例编号：前段为产品名称（型号），后段为来源用例编号或产品专属序号 */
function prodCaseNo(model, tail) { return `${model}-${tail}`; }
/* ---------- 大数据集下的查找索引：避免「对每个引用做全库线性扫描」造成的性能问题 ----------
   索引在渲染入口（renderApp / renderStd / renderProd / renderStats / renderTodo）重建，
   渲染期间复用；用例编号变化处调用 resetStdCaseIndex() 强制失效。 */
let __stdIndexArr = null, __stdIndexLen = -1, __stdCaseMap = new Map();
function ensureStdIndex() {
  if (__stdIndexArr === DB.stdCases && __stdIndexLen === DB.stdCases.length) return;
  __stdIndexArr = DB.stdCases;
  __stdIndexLen = DB.stdCases.length;
  __stdCaseMap = new Map();
  DB.stdCases.forEach(c => __stdCaseMap.set(c.id, c));
}
function stdCaseById(id) { ensureStdIndex(); return __stdCaseMap.get(id); }
function resetStdCaseIndex() { __stdIndexArr = null; __stdIndexLen = -1; __refIdxProds = null; }
let __modArr = null, __modMap = new Map();
function moduleDomainOf(name, fallback) {
  if (__modArr !== DB.stdModules) {
    __modArr = DB.stdModules;
    __modMap = new Map();
    (DB.stdModules || []).forEach(m => __modMap.set(m.name, m));
  }
  const m = __modMap.get(name);
  return (m && m.domain) || fallback || '—';
}
/* 产品用例行的「用例内容字段」：引用行取源模块用例、增补行取增补记录本身，
   与模块用例库的内容字段保持一致（产品侧元数据另行叠加） */
function prodContentFields(c) {
  const o = c || {};
  return {
    testProject: o.testProject || o.module || '—',
    /* 用例来源：引用行取源模块用例的来源，增补行取增补记录自身的来源 */
    caseSource: o.caseSource || o.source || '需求',
    minutes: o.minutes == null || o.minutes === '' ? '—' : o.minutes,
    autoFlag: o.autoFlag || '否',
    autoTool: o.autoTool || '—',
    autoTime: o.autoTime == null || o.autoTime === '' ? '—' : o.autoTime,
    autoUpdatedAt: o.autoUpdatedAt || '—',
    bugCount: o.bugCount == null ? 0 : o.bugCount,
    bugIds: (o.bugIds || []).slice(),
    bugId: o.bugId || '—',
    marketBug: o.marketBug || '',
    marketBugDate: o.marketBugDate || ''
  };
}
function prodCaseRows(p, depth) {
  const lv = depth || 0;
  const rows = [];
  (p.refs || []).forEach(r => {
    (r.caseIds || []).forEach(id => {
      const c = stdCaseById(id);
      if (!c) return;
      rows.push({
        id: prodCaseNo(p.model, c.id), stdCaseId: c.id, source: '引用模块库', module: c.module, branch: c.branch,
        summary: c.summary, level: c.level, status: c.status, feedback: '',
        pre: c.pre, steps: c.steps, input: c.input, expect: c.expect, remark: c.remark,
        designer: c.designer, date: r.date || c.designDate || '',
        /* 分析维度（用于产品用例库左侧齐全度分析树） */
        domain: c.domain || moduleDomainOf(c.module, p.domain),
        series: p.series || '—', model: p.model,
        testType: c.testType || '功能测试', functionPoint: c.functionPoint || '—', testPoint: c.testPoint || '—',
        /* 内容字段与模块用例库一致（引用行只读继承源用例） */
        ...prodContentFields(c)
      });
    });
  });
  (p.added || []).forEach(a => rows.push({
    id: a.id, stdCaseId: '', source: '产品专属增补', module: a.module, branch: '产品专属',
    summary: a.summary, level: a.level, status: '正常', feedback: a.feedback, fromRef: a.fromRef || '',
    pre: a.pre, steps: a.steps, input: a.input, expect: a.expect, remark: a.remark,
    designer: a.reviewer || a.designer || '', date: a.date || '',
    domain: a.domain || moduleDomainOf(a.module, p.domain),
    series: p.series || '—', model: p.model,
    testType: a.testType || '功能测试', functionPoint: a.functionPoint || a.module || '—', testPoint: a.testPoint || '—',
    /* 内容字段与模块用例库一致（增补行取增补记录自身的值） */
    ...prodContentFields(a)
  }));
  /* 引用其他产品的产品用例：编号沿用被引用用例编号，不新增前缀（层级保护，避免循环引用） */
  if (lv < 3) {
    (p.prodRefs || []).forEach(pr => {
      if (pr.fromModel === p.model) return;
      const src = DB.products.find(x => x.model === pr.fromModel);
      if (!src) return;
      const srcRows = prodCaseRows(src, lv + 1);
      (pr.caseIds || []).forEach(id => {
        const r = srcRows.find(x => x.id === id);
        if (!r) return;
        rows.push(Object.assign({}, r, {
          id: r.id, source: '引用产品用例', fromProduct: r.fromProduct || pr.fromModel,
          stdCaseId: r.stdCaseId || '', feedback: r.feedback || '',
          series: p.series || '—', model: p.model,
          domain: r.domain || p.domain || '—'
        }));
      });
    });
  }
  return rows;
}
/* refs 未显式记录 caseIds 时，按「模块 + 分支」标准用例补全（产品引用条数以 count 为准，不足时按 count 截取） */
function normalizeProducts() {
  DB.products.forEach(p => {
    p.refs = (p.refs || []).map(r => {
      if (!r.caseIds) {
        const pool = DB.stdCases.filter(c => c.module === r.module && c.branch === r.branch);
        r.caseIds = (r.count && r.count < pool.length ? pool.slice(0, r.count) : pool).map(c => c.id);
      }
      if (!r.date) r.date = today();
      return r;
    });
    p.added = p.added || [];
    /* 引用其他产品的产品用例（编号沿用被引用用例编号，不加前缀） */
    p.prodRefs = (p.prodRefs || []).map(pr => ({ fromModel: pr.fromModel, caseIds: (pr.caseIds || []).slice() })).filter(pr => pr.fromModel !== p.model && pr.caseIds.length);
  });
}
function buildItems(model, limit) {
  const p = DB.products.find(x => x.model === model);
  if (!p) return [];
  const rows = prodCaseRows(p).map(r => ({ id: r.id, module: r.module, branch: r.branch, summary: r.summary, level: r.level, source: r.source, result: '', note: '' }));
  return limit ? rows.slice(0, limit) : rows;
}
function moduleOwner(name) { const m = DB.stdModules.find(x => x.name === name); return m ? m.owner : ''; }
/* 自定义功能模块：模块划分表中不存在时自动纳入（领域取所选值，责任人为当前登录用户） */
function ensureModuleExists(name, domain, source) {
  const n = String(name == null ? '' : name).trim();
  if (!n || DB.stdModules.some(m => m.name === n)) return false;
  const dom = domain || '固件';
  DB.stdModules.push({ name: n, domain: dom, owner: DB.currentUser });
  /* 若该模块曾被手工删除，现由用例再次使用则视为重新创建 */
  DB.delModules = (DB.delModules || []).filter(x => x !== n);
  if (!DB.deptMembers.includes(DB.currentUser)) DB.deptMembers.push(DB.currentUser);
  log('新增功能模块', `${n}｜领域 ${dom}｜责任人 ${DB.currentUser}（${source || '自定义填写'}时自动创建）`);
  return true;
}
function srcTag(source) {
  if (source === '产品专属增补') return '<span class="chip chip-warn">产品专属增补</span>';
  if (source === '引用产品用例') return '<span class="chip chip-primary">引用产品用例</span>';
  return '<span class="chip chip-info">引用模块库</span>';
}
function allReviews() {
  return DB.moduleReviews.map(r => Object.assign({}, r, { bucket: 'module' }))
    .concat(DB.productReviews.map(r => Object.assign({}, r, { bucket: 'product' })));
}
function reviewList(bucket) { return bucket === 'module' ? DB.moduleReviews : DB.productReviews; }

/* ================= 我的待办（平台审批流程） ================= */
function isOpenReview(r) { return r.status === '审核中' || r.status === '待审核'; }
function hasVoted(r) { return r.opinions.some(o => o[0] === DB.currentUser); }
function todoData() {
  const u = DB.currentUser;
  const open = allReviews().filter(isOpenReview);
  return {
    reviews: open.filter(r => r.submitter !== u && !hasVoted(r) && (!r.participants.length || r.participants.includes(u))),
    mine: open.filter(r => r.submitter === u),
    reflows: DB.lineageProdToStd.filter(l => l.status === '待模块责任人确认' && moduleOwner(l.module) === u),
    execs: DB.execTasks.filter(e => execPending(e) > 0),
    /* 回退用例：审核未通过 / 逐条 decline 后回到发起人待办，需修改后重新提交 */
    returns: DB.stdCases.filter(c => c.status === '回退' && (c.designer === u || c.returnTo === u)),
    /* 待我导出：导出审批已通过、等申请人本人下载文件（流程停在申请人处） */
    exports: myExportTodos()
  };
}
function todoCount() { const t = todoData(); return t.reviews.length + t.reflows.length + t.execs.length + t.returns.length + t.exports.length; }

/* ================= 框架 ================= */
/* ================= 权限（角色分级：登录后按角色表匹配权限项） ================= */
/* 权限项兜底文案（权限项以 DB.permCatalog 为准，此处仅作旧数据兜底） */
const PERM_LABELS = { view: '查看用例库', edit: '新建 / 导入用例', modify: '修改用例', disable: '停用 / 启用用例', export: '导出用例', audit: '参与审核', reviewCreate: '发起审核', manage: '用例管理', task: '任务管理', exec: '任务执行', bug: '提交 Bug', delete: '删除数据', roleManage: '角色与权限配置' };
function permCatalog() { return DB.permCatalog || []; }
function permItems() { return permCatalog().reduce((a, g) => a.concat(g.items || []), []); }
function permLabel(k) { const it = permItems().find(i => i.k === k); return it ? it.label : (PERM_LABELS[k] || k); }
function permLabels(list) { return (list || []).map(permLabel).join('、'); }
function roleOf(user) {
  const u = user || DB.currentUser;
  const r = (DB.roles || []).find(x => (x.users || []).includes(u));
  if (r) return r.name;
  /* 未出现在任何角色成员表里的账号（如自助注册）：回落到权限最小的「三级」 */
  const fb = (DB.roles || []).find(x => x.name === '三级') || (DB.roles || [])[0];
  return fb ? fb.name : '三级';
}
function roleDef(name) {
  return (DB.roles || []).find(x => x.name === (name || DB.currentRole)) || { name: name || DB.currentRole, desc: '', users: [], perms: [] };
}
/* 当前生效权限 = 当前登录账号所属角色所配置的权限项（角色由「设置」维护） */
function effectivePerms(role) { return (roleDef(role || DB.currentRole).perms || []).slice(); }
function can(perm) { return effectivePerms().indexOf(perm) >= 0; }
/* 账号等级：最高管理员 0 / 一级 1 / 二级 2 / 三级 3；未知角色按最低权限（9）处理 */
const ROLE_RANK = { '最高管理员': 0, '一级': 1, '二级': 2, '三级': 3 };
function roleRank(name) { const r = ROLE_RANK[name || DB.currentRole]; return r == null ? 9 : r; }
/* 「一级及以上」= 最高管理员 / 一级：任务与执行任务结束后的「重新开启」只允许这些账号操作 */
function isLv1OrAbove(name) { return roleRank(name) <= 1; }
function permDisabled(perm) { return can(perm) ? '' : 'disabled'; }
function permTitle(perm, label) { return can(perm) ? '' : `title="当前账号（${DB.currentUser} · ${DB.currentRole}）无「${label || permLabel(perm)}」权限"`; }
window.guard = function (perm, label) {
  if (can(perm)) return true;
  toast(`当前账号（${DB.currentUser} · ${DB.currentRole}）无「${label || permLabel(perm)}」权限`, 'error');
  return false;
};
/* 权限变更留痕（角色 / 权限项 / 成员） */
function auditPerm(target, action) {
  DB.permAudits = DB.permAudits || [];
  DB.permAudits.unshift({ time: nowStr(), operator: DB.currentUser, target, action });
  save();
}
/* 切换账号 / 角色后保持当前视图（执行页停留在执行页） */
function redrawKeepView() {
  /* 执行明细页的判定改用执行表格容器（原判定依赖已下线的「保存执行结果」按钮） */
  const inExec = !!(state.execCase && state.execCase.execId && $('#ecTableWrap'));
  if (inExec) { renderHeader(); renderExecCases(); } else { renderApp(); }
}
/* 头像控件：有自定义图片显示图片，否则显示账号首字 */
function avatarHtml(size) {
  const name = String(DB.currentUser || '');
  const url = (SESSION && SESSION.avatar) || '';
  const cls = 'avatar' + (size ? ' avatar-' + size : '');
  if (url) return `<span class="${cls}"><img src="${url}" alt=""></span>`;
  return `<span class="${cls}">${name.trim().charAt(0).toUpperCase() || '?'}</span>`;
}
window.toggleUserMenu = function (e) {
  if (e) e.stopPropagation();
  const m = $('#userMenu'); if (!m) return;
  m.classList.toggle('open');
};
/* 个人账号设置：头像上传 / 邮箱绑定 / 修改密码 / 退出登录 */
window.openMyAccount = function () {
  const role = roleDef(DB.currentRole) || { perms: [] };
  const mail = (SESSION && SESSION.email) || '';
  modal('个人账号设置', `
    <div class="acct-hero">
      <div class="acct-avatar-wrap">
        ${avatarHtml('xl')}
        <button class="btn btn-ghost btn-sm" onclick="pickAvatar()">更换头像</button>
        ${(SESSION && SESSION.avatar) ? '<span class="link" style="font-size:12px" onclick="removeAvatar()">移除头像</span>' : ''}
      </div>
      <div>
        <div class="acct-name">${DB.currentUser}</div>
        <div class="acct-role">${DB.currentRole} · ${(role.perms || []).length} 项权限</div>
        <div class="acct-mail">${mail || '未绑定邮箱'}</div>
      </div>
    </div>
    <div class="form">
      <div class="field"><label>绑定邮箱（用于找回账号 / 接收通知）</label><input id="acEmail" value="${mail}" placeholder="name@company.com"></div>
    </div>
    <input type="file" id="avatarFile" accept="image/*" style="display:none">
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">关闭</button>
      <button class="btn btn-ghost" onclick="openChangePassword()">修改密码</button>
      <button class="btn btn-primary" id="acSave">保存邮箱</button>
    </div>`);
  const file = $('#avatarFile');
  file.onchange = async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('请选择图片文件', 'error'); return; }
    try {
      const data = await readAvatarImage(f);
      const r = await API.setAvatar(data);
      if (!SESSION) SESSION = {};
      SESSION.avatar = r.avatar || data;
      closeTopModal(); renderHeader(); toast('头像已更新', 'success');
    } catch (e) { toast(e.message || '头像上传失败', 'error'); }
  };
  $('#acSave').onclick = async () => {
    try {
      const r = await API.setEmail($('#acEmail').value.trim());
      if (!SESSION) SESSION = {};
      SESSION.email = r.email || '';
      closeTopModal(); renderHeader(); toast('邮箱已保存', 'success');
    } catch (e) { toast(e.message || '保存失败', 'error'); }
  };
};
window.switchUserView = window.openMyAccount;
window.pickAvatar = function () { const i = $('#avatarFile'); if (i) { i.value = ''; i.click(); } };
window.removeAvatar = async function () {
  try {
    await API.setAvatar('');
    if (SESSION) SESSION.avatar = '';
    closeTopModal(); renderHeader(); toast('头像已移除', 'success');
  } catch (e) { toast(e.message || '操作失败', 'error'); }
};
/* 图片裁成正方形并压缩到 200×200，避免头像文件过大 */
function readAvatarImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const S = 200, c = document.createElement('canvas');
        c.width = S; c.height = S;
        const ctx = c.getContext('2d');
        const k = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, S, S);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => reject(new Error('图片解析失败'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error('读取文件失败'));
    fr.readAsDataURL(file);
  });
}
window.openChangePassword = function () {
  modal('修改登录密码', `
    
    <div class="form">
      <div class="field"><label>原密码</label><input id="pwOld" type="password" autocomplete="current-password"></div>
      <div class="field"><label>新密码</label><input id="pwNew" type="password" autocomplete="new-password"></div>
      <div class="field"><label>确认新密码</label><input id="pwNew2" type="password" autocomplete="new-password"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="pwOk">保存</button>
    </div>`);
  $('#pwOk').onclick = async () => {
    const o = $('#pwOld').value, n = $('#pwNew').value, n2 = $('#pwNew2').value;
    if (!o || !n) { toast('请填写完整', 'error'); return; }
    if (n.length < 6) { toast('新密码至少 6 位', 'error'); return; }
    if (n !== n2) { toast('两次输入的新密码不一致', 'error'); return; }
    try {
      await API.changePassword(o, n);
      closeTopModal();
      toast('密码已修改，下次登录请使用新密码', 'success');
    } catch (e) {
      toast(e.message || '修改失败', 'error');
    }
  };
};
window.logoutConfirm = function () {
  confirmModal('退出登录', '<p>退出后需要重新登录才能继续操作（当前数据已保存到服务器）。</p>', async () => {
    try { await API.logout(); } catch (e) { }
    API.setToken('');
    SESSION = null;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(VIEW_KEY); } catch (e) { }
    location.reload();
  }, '退出登录');
};

const NAV = [
  { id: 'todo', label: '我的待办' },
  { id: 'stats', label: '数据统计' },
  { id: 'std', label: '模块用例库' },
  { id: 'prod', label: '产品用例库' },
  { id: 'tasks', label: '执行任务' },
  { id: 'archive', label: '归档任务' },
  { id: 'reviews', label: '审核中心' },
  { id: 'perm', label: '设置' }
];

/* ---------- 页签权限：页面访问权限可自定义，无权限的页签直接隐藏（导航不显示，跳转拦截） ---------- */
const NAV_PERM = {
  stats: 'page.stats',      /* 数据统计 */
  std: 'page.std',          /* 模块用例库 */
  prod: 'page.prod',        /* 产品用例库 */
  tasks: 'page.tasks',      /* 执行任务 */
  archive: 'page.archive',  /* 归档任务 */
  reviews: 'page.reviews',  /* 审核中心 */
  perm:  'page.perm'         /* 设置 */
};
/* 设置页只对最高管理员开放（其他角色即使勾选了「页面访问」也不显示入口） */
function tabAllowed(id) {
  if (id === 'perm' && roleRank() !== 0) return false;
  const p = NAV_PERM[id];
  return !p || can(p);
}
function visibleNav() { return NAV.filter(x => tabAllowed(x.id)); }
/* 跳转保护：目标页签已被隐藏时拦截跳转（页内按钮不再指向无权限页面） */
function ensureTab(id) {
  if (tabAllowed(id)) return true;
  const label = (NAV.find(x => x.id === id) || {}).label || id;
  toast(`当前账号（${DB.currentUser} · ${DB.currentRole}）无法访问「${label}」`, 'error');
  return false;
}

function renderHeader() {
  const n = todoCount();
  $('#app').innerHTML = `<header>
    <div class="logo" title="测试任务执行平台"><span class="logo-text">测试任务执行平台</span></div>
    <nav>${visibleNav().map(x => `<button data-tab="${x.id}" class="${state.tab === x.id ? 'active' : ''}">${x.label}${x.id === 'todo' && n ? ` <span class="badge">${n}</span>` : ''}</button>`).join('')}</nav>
    <div class="userbar">
      <button class="user-btn" id="userBtn" onclick="toggleUserMenu(event)">
        ${avatarHtml()}<span class="user-btn-name">${DB.currentUser}</span><span class="user-caret">▾</span>
      </button>
      <div class="user-menu" id="userMenu">
        <div class="um-head">${avatarHtml('lg')}<div><b>${DB.currentUser}</b><span>${DB.currentRole}${(SESSION && SESSION.email) ? ' · ' + SESSION.email : ''}</span></div></div>
        <button class="um-item" onclick="openMyAccount()">个人账号设置</button>
        <button class="um-item" onclick="openMyLogs()">操作日志</button>
        ${roleRank() === 0 ? '<button class="um-item" onclick="clearAllData()">清空数据</button>' : ''}
        <div class="um-sep"></div>
        <button class="um-item um-danger" onclick="logoutConfirm()">退出登录</button>
      </div>
    </div>
  </header><div id="page" class="page"></div>`;
  $$('nav button').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderApp(); });
  /* 点击空白处 / Esc 收起账号菜单（只绑定一次） */
  if (!state.__umBound) {
    state.__umBound = true;
    document.addEventListener('click', e => {
      const m = $('#userMenu');
      if (m && m.classList.contains('open') && !e.target.closest('.userbar')) m.classList.remove('open');
    });
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      const m = $('#userMenu');
      if (m) m.classList.remove('open');
    });
  }
}
function renderApp() {
  resetStdCaseIndex();
  /* 通过页签导航离开「用例执行明细页」时清理执行页上下文，避免刷新后又被带回执行页 */
  if (state.execCase && state.execCase.execId) state.execCase = null;
  /* 当前页签无权限（如刚切换了角色）时，自动回落到第一个可见页签 */
  const vis = visibleNav();
  if (!vis.some(x => x.id === state.tab)) state.tab = (vis[0] || { id: 'todo' }).id;
  /* 记住当前视图：刷新后停留在本页面，不跳回首页（我的待办） */
  saveView();
  renderHeader();
  ({ todo: renderTodo, stats: renderStats, std: renderStd, prod: renderProd, tasks: renderTasks, archive: renderArchive, reviews: renderReviews, perm: renderPerm }[state.tab] || renderTodo)();
  /* 动效：只有「页签真的变了」才给页面容器加淡入上浮；
     同页签内的连续重绘（保存、筛选等）不加动画，避免闪烁与多余重绘 */
  if (state.__renderTab !== state.tab) {
    state.__renderTab = state.tab;
    const page = $('#page');
    if (page) page.classList.add('page-in');
  }
  /* 页面内的下拉框统一增强为关键字搜索下拉 */
  enhanceSelects(document);
  /* 表格列宽统一适配（短列托底、长文本列限宽 2 行） */
  fitAllTables(document);
}

/* ---------- 我的待办 ---------- */
function renderTodo() {
  resetStdCaseIndex();
  const t = todoData();
  const empty = n => `<tr><td colspan="${n}" class="empty">暂无待办事项</td></tr>`;
  $('#page').innerHTML = `
    <div class="cards">
      <div class="card"><div class="card-num">${t.reviews.length}</div><div class="card-title">待我审核</div></div>
      <div class="card c-warn"><div class="card-num">${t.reflows.length}</div><div class="card-title">待我确认回流</div></div>
      <div class="card c-info"><div class="card-num">${t.execs.length}</div><div class="card-title">进行中执行任务</div></div>
      <div class="card c-danger"><div class="card-num">${t.mine.length}</div><div class="card-title">我发起的流程</div></div>
      <div class="card c-info"><div class="card-num">${t.exports.length}</div><div class="card-title">待我导出</div></div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">待我审核 <span class="chip">${t.reviews.length} 项</span></h2>
        ${tabAllowed('reviews') ? `<button class="btn btn-ghost btn-sm" onclick="state.tab='reviews';renderApp()">前往审核中心</button>` : ''}
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>审核单号</th><th>类型</th><th>审核对象</th><th>审核范围</th><th>提交人</th><th>审核期限</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${t.reviews.map(r => `<tr>
          <td>${r.id}</td><td>${r.type}</td><td>${r.target}</td>
          <td>${pill(r.bucket === 'module' ? '部门内' : '项目内', 'gray')}</td><td>${r.submitter}</td><td>${r.deadline}</td>
          <td>${pill(r.status)}</td>
          <td><span class="link" onclick="openReview('${r.id}','${r.bucket}')">去审核</span></td>
        </tr>`).join('') || empty(8)}</tbody></table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">待我确认回流 <span class="chip">我是该模块维护责任人</span></h2>
        ${tabAllowed('std') && can('manage') ? `<button class="btn btn-ghost btn-sm" onclick="state.tab='std';renderApp();openModuleManage()">模块划分表 / 责任人设置</button>` : ''}
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>产品用例编号</th><th>所属产品</th><th>功能模块</th><th>回流分支</th><th>用例概述</th><th>提交人</th><th>提交日期</th><th>操作</th></tr></thead>
        <tbody>${t.reflows.map(l => `<tr>
          <td>${l.prodCase}</td><td>${l.product}</td><td>${l.module}</td>
          <td>${normBranch(l.branch) || '产品通用'}${(l.refProducts || []).length ? ' · ' + (l.refProducts || []).join('、') : ''}</td>
          <td>${l.summary}</td><td>${l.submitter}</td><td>${l.submitDate}</td>
          <td><span class="link" onclick="openReflow('${l.prodCase}')">处理回流</span></td>
        </tr>`).join('') || empty(8)}</tbody></table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">待我审批的导出申请 <span class="chip">${myExportRequests().length}</span></h2>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>申请单号</th><th>导出类型</th><th>范围 / 条数</th><th>申请人</th><th>导出原因</th><th>审批截止</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${myExportRequests().map(r => `<tr>
          <td>${r.id}</td><td>${r.type}</td><td>${r.scope}</td><td>${r.applicant}</td>
          <td style="white-space:normal">${r.reason}</td><td>${r.deadline}</td><td>${pill(r.status)}</td>
          <td><span class="link" onclick="approveExport('${r.id}',true)">通过</span>
              <span class="link" onclick="approveExport('${r.id}',false)">驳回</span></td>
        </tr>`).join('') || empty(8)}</tbody></table>
      </div>
    </div>

    ${exportTodoPanelHtml()}

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">我的回退用例 <span class="chip">${t.returns.length}</span></h2>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>用例编号</th><th>功能模块</th><th>用例概述</th><th>回退原因</th><th>回退日期</th><th>操作</th></tr></thead>
        <tbody>${t.returns.map(c => `<tr>
          <td>${stdCaseNoLabel(c)}</td><td>${c.module}</td><td style="white-space:normal">${c.summary}</td>
          <td style="white-space:normal">${c.returnReason || '—'}</td><td>${c.returnDate || '—'}</td>
          <td><span class="link" onclick="resubmitReturnedCase('${c.id}')">修改并重新提交</span></td>
        </tr>`).join('') || empty(6)}</tbody></table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">企业微信提醒记录 <span class="chip">${(DB.notices || []).length}</span></h2>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>时间</th><th>提醒对象</th><th>类型</th><th>内容</th></tr></thead>
        <tbody>${(DB.notices || []).slice(0, 10).map(n => `<tr>
          <td>${n.time}</td><td>${n.to}</td><td>${n.type}</td><td style="white-space:normal">${n.content}</td>
        </tr>`).join('') || empty(4)}</tbody></table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">进行中的执行任务</h2>
        ${tabAllowed('tasks') ? `<button class="btn btn-ghost btn-sm" onclick="state.tab='tasks';renderApp()">前往执行任务</button>` : ''}
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>执行任务编号</th><th>任务名称</th><th>产品型号</th><th>计划执行</th><th>已执行</th><th>进度</th><th>执行人</th><th>操作</th></tr></thead>
        <tbody>${t.execs.map(e => {
          const st = execStats(e), planned = execPlanned(e);
          const pct = planned ? Math.round(st.actual * 100 / planned) : 0;
          return `<tr>
          <td>${e.execId}</td><td>${e.name}</td><td>${e.model}</td><td>${planned}</td><td>${st.actual}</td>
          <td class="nowrap"><span class="prog"><span style="width:${pct}%"></span></span> ${pct}%</td>
          <td>${e.executors}</td>
          <td><span class="link" onclick="openExec('${e.execId}')">去执行</span></td>
        </tr>`; }).join('') || empty(8)}</tbody></table>
      </div>
    </div>

    <div class="panel">
      <h2 class="panel-title">我发起 / 我参与的流程 <span class="chip">${t.mine.length} 项处理中</span></h2>
      <div class="table-wrap" style="margin-top:4px">
        <table><thead><tr><th>审核单号</th><th>类型</th><th>审核对象</th><th>提交日期</th><th>审核期限</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${t.mine.map(r => `<tr>
          <td>${r.id}</td><td>${r.type}</td><td>${r.target}</td><td>${r.submitDate}</td><td>${r.deadline}</td>
          <td>${pill(r.status)}</td>
          <td><span class="link" onclick="openReview('${r.id}','${r.bucket}')">查看 / 催办</span></td>
        </tr>`).join('') || empty(7)}</tbody></table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">操作日志 <span class="chip">${(DB.logs || []).length} 条</span></h2>
        <span class="link" onclick="openMyLogs()">查看全部</span>
      </div>
      <div class="table-wrap" style="margin-top:4px">
        <table><thead><tr><th style="width:150px">时间</th><th style="width:110px">操作人</th><th style="width:86px">模块</th><th style="width:170px">操作</th><th>变更明细 / 说明</th></tr></thead>
        <tbody>${todoLogRows(12) || empty(5)}</tbody></table>
      </div>
    </div>`;
}

/* ---------- 模块用例库 ---------- */
/* 列表筛选条件（多选条件为空数组即「不限」）：工具条筛选项，供列表与导出共用 */
function stdCaseMatchesFilters(c) {
  const kw = String(state.stdKeyword == null ? '' : state.stdKeyword).trim();
  const levels = asList(state.stdLevel), mods = asList(state.stdModule);
  return (!kw || c.id.includes(kw) || c.summary.includes(kw) || c.functionPoint.includes(kw)) &&
    (!levels.length || levels.indexOf(c.level) >= 0) &&
    (!mods.length || mods.indexOf(c.module) >= 0) &&
    moduleAppliesModel(c, state.stdModel);
}
/* 当前列表（工具条筛选 + 树节点筛选） */
function stdFilteredList() {
  resetStdCaseIndex();
  return moduleTreeFiltered(DB.stdCases.filter(stdCaseMatchesFilters));
}
/* 工具条：三个下拉均为多选（命中任一所选项即列出），勾选即时生效，不必点「搜索」 */
function stdToolbarHtml(listed) {
  const mods = asList(state.stdModule), levels = asList(state.stdLevel), models = asList(state.stdModel);
  return `
    <div class="toolbar">
      <div><label>模糊搜索</label><input id="kw" placeholder="请输入关键字" value="${state.stdKeyword}"></div>
      <div><label>功能模块</label><select id="mod" multiple data-ssel-empty="全部模块" title="可多选：命中任一模块的用例都会列出">${DB.stdModules.map(m => `<option value="${m.name}" ${mods.indexOf(m.name) >= 0 ? 'selected' : ''}>${m.name}</option>`).join('')}</select></div>
      <div><label>用例等级</label><select id="lv" multiple data-ssel-empty="全部等级" title="可多选：命中任一等级的用例都会列出">${['L1', 'L2', 'L3'].map(l => `<option value="${l}" ${levels.indexOf(l) >= 0 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div title="可多选：含「产品通用」不限型号用例 + 「指定产品」中声明了所选任一型号的用例"><label>适用产品型号</label><select id="stdModel" multiple data-ssel-empty="全部型号">${stdModelOptions().map(m => `<option value="${m}" ${models.indexOf(m) >= 0 ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <button class="btn btn-primary" id="search">搜索</button>
      <button class="btn btn-ghost" id="resetFilter">重置</button>
      <span class="chip chip-primary" id="stdCount">共 ${listed.length} 条</span>
    </div>`;
}
function stdBodyHtml(listed) {
  const pages = Math.max(1, Math.ceil(listed.length / state.stdSize));
  state.stdPage = Math.min(state.stdPage, pages);
  const page = listed.slice((state.stdPage - 1) * state.stdSize, state.stdPage * state.stdSize);
  const kw = state.stdModuleKw.trim();
  const treeMods = DB.stdModules.filter(m => !kw || m.name.includes(kw) || (m.owner || '').includes(kw));
  const mods = asList(state.stdModule);
  /* 模块内层级树只对「唯一选中模块」展开：多选时是并列清单，不宜再叠加树节点筛选 */
  const expanded = mods.length === 1 ? mods[0] : '';
  return `
    ${exportTodoBannerHtml()}
    <div class="flex">
      <aside class="sidebar">
        <h4>模块用例库结构</h4>
        <input id="treeKw" placeholder="搜索模块名称 / 责任人" value="${state.stdModuleKw}">
        <div class="tree-list">
          <div class="tree-item ${!mods.length ? 'active' : ''}" data-mod="">
            <div class="ti-name"><span class="expand">▣</span> 全部模块 <span class="ti-edit">${DB.stdCases.length}</span></div>
          </div>
          ${treeMods.map(m => `<div class="tree-item ${mods.indexOf(m.name) >= 0 ? 'active' : ''}" data-mod="${m.name}">
            <div class="ti-name"><span class="expand">${expanded === m.name ? '▾' : '▸'}</span> ${m.name}
              ${can('manage') ? `<span class="ti-edit" title="设置维护责任人" onclick="event.stopPropagation();openModuleOwner('${m.name}')">✎</span>` : ''}
            </div>
            <div class="ti-meta">${m.domain} · ${DB.stdCases.filter(c => c.module === m.name).length} 条用例</div>
            <div class="ti-meta">责任人 <span class="nowrap" style="color:${m.owner ? '#0d8a7c' : '#ef4444'}">${m.owner || '未指定'}</span></div>
          </div>
          ${expanded === m.name ? moduleTreeHtml(m.name) : ''}`).join('') || '<div class="empty" style="padding:20px">无匹配模块</div>'}
        </div>
        ${can('manage') ? `<div class="sidebar-foot">
          <button class="btn btn-ghost btn-sm" style="width:100%" onclick="openModuleManage()">模块划分表 / 责任人设置</button>
        </div>` : ''}
      </aside>
      <div class="main">
        <div class="panel">
          <div class="panel-header">
            <div class="actions">
              ${can('edit') ? '<button class="btn btn-primary" onclick="newStdCase()">＋ 新建模块用例</button>' : ''}
              ${can('edit') ? '<button class="btn btn-ghost" onclick="importCases()">导入用例（Excel）</button>' : ''}
              <button class="btn btn-ghost" onclick="downloadStdTemplate()">导入模板</button>
              ${can('export') ? '<button class="btn btn-ghost" onclick="exportStd()">导出 Excel（需审批）</button>' : ''}
              <button class="btn btn-danger" id="btnOff" ${state.selected.length && can('edit') ? '' : 'disabled'} title="${state.selected.length ? permTitle('edit') ? '' : '' : '请先勾选用例'}" onclick="disableStd()">停用</button>
              <button class="btn btn-ghost" id="btnOn" ${state.selected.length && can('edit') ? '' : 'disabled'} title="${state.selected.length ? '' : '请先勾选用例'}" onclick="enableStd()">启用</button>
              <button class="btn btn-ghost" onclick="openStdStats()">用例统计</button>
              <span class="hint" style="margin:0">已选 <b id="selCount">${state.selected.length}</b> 条${can('edit') ? '' : '（无修改权限，只读）'}</span>
            </div>
            <button class="btn btn-ghost" onclick="openColPicker('std')">筛选列</button>
          </div>
          <div class="table-wrap">${stdTable(page)}</div>
          ${pagerFull(listed.length, state.stdPage, pages, state.stdSize, 'stdSize')}
        </div>
      </div>
    </div>`;
}
function bindStdToolbar() {
  const sel3 = ['#mod', '#lv', '#stdModel'].map(id => $(id)).filter(Boolean);
  const valsOf = sel => Array.from(sel.selectedOptions || []).map(o => o.value).filter(v => v !== '');
  /* 下拉多选：勾选即时筛选（读取当前选中集合，增强层与原生 select 都适用） */
  const apply = () => {
    state.stdModule = valsOf($('#mod'));
    state.stdLevel = valsOf($('#lv'));
    state.stdModel = valsOf($('#stdModel'));
    /* 只有唯一模块时才展开模块内层级树；多选模块时清掉树节点筛选，避免跨模块误筛 */
    if (asList(state.stdModule).length !== 1) state.stdTreePath = {};
    state.stdPage = 1;
    refreshStdBody();
  };
  sel3.forEach(s => { s.onchange = apply; });
  $('#search').onclick = () => { state.stdKeyword = $('#kw').value; apply(); };
  $('#resetFilter').onclick = () => {
    state.stdKeyword = ''; state.stdLevel = []; state.stdModule = []; state.stdModuleKw = '';
    state.stdTreePath = {}; state.stdModel = []; state.stdPage = 1;
    renderStd();
  };
  $('#kw').onkeydown = e => { if (e.key === 'Enter') $('#search').click(); };
}
function bindStdBody() {
  const tk0 = $('#treeKw');
  if (tk0) tk0.oninput = e => { state.stdModuleKw = e.target.value; refreshStdBody(); setTimeout(() => { const el = $('#treeKw'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); };
  /* 点击功能模块：筛选该模块并按树展开（分支 → 测试类型 → 功能点 → 测试点） */
  $$('.tree-item[data-mod]').forEach(el => el.onclick = () => {
    if (el.dataset.mod === undefined) return;
    state.stdModule = el.dataset.mod ? [el.dataset.mod] : [];
    state.stdTreePath = {};
    state.stdPage = 1;
    renderStd();
  });
  bindModuleTree();
  const syncSel = () => {
    state.selected = $$('.rowchk:checked').map(x => x.value);
    const n = state.selected.length;
    if ($('#selCount')) $('#selCount').textContent = n;
    ['#btnOff', '#btnOn'].forEach(id => {
      const b = $(id);
      if (!b) return;
      b.disabled = !n;
      b.title = n ? '' : '请先勾选用例';
    });
  };
  $$('.rowchk').forEach(c => c.onchange = syncSel);
  const all = $('#chkAll');
  if (all) all.onchange = () => { $$('.rowchk').forEach(c => c.checked = all.checked); syncSel(); };
  bindPager(p => { state.stdPage = p; renderStd(); });
  const sz = $('#stdSize');
  if (sz) sz.onchange = () => { state.stdSize = +sz.value; state.stdPage = 1; renderStd(); };
}
function renderStd() {
  const listed = stdFilteredList();
  $('#page').innerHTML = stdToolbarHtml(listed) + `<div id="stdBody">${stdBodyHtml(listed)}</div>`;
  bindStdToolbar();
  bindStdBody();
}
/* 筛选条件变化时的轻量刷新：只重画右侧清单与左侧树，保留工具条 DOM ——
   多选下拉（.ssel 增强层）在工具条内，重画工具条会把正在勾选的面板关掉 */
function refreshStdBody() {
  const host = $('#stdBody');
  if (!host) return renderStd();
  const listed = stdFilteredList();
  const tw0 = host.querySelector('.table-wrap');
  const scrollLeft = tw0 ? tw0.scrollLeft : 0;
  host.innerHTML = stdBodyHtml(listed);
  bindStdBody();
  const tw = host.querySelector('.table-wrap');
  if (tw) tw.scrollLeft = scrollLeft;
  const cnt = $('#stdCount');
  if (cnt) cnt.textContent = `共 ${listed.length} 条`;
}
/* 导出范围：与工具条筛选口径一致（不含树节点筛选，树节点是列表视图层的收窄） */
function filteredStdCases() {
  return DB.stdCases.filter(stdCaseMatchesFilters);
}
function stdTable(list) {
  return tableByCols('std', list, {
    leadHead: '<th style="width:40px"><input type="checkbox" id="chkAll"></th>',
    leadCell: c => `<td><input type="checkbox" class="rowchk" value="${c.id}" ${state.selected.includes(c.id) ? 'checked' : ''}></td>`
  });
}
window.gotoProd = function (model) {
  if (!ensureTab('prod')) return;
  state.tab = 'prod'; state.prodIndex = Math.max(0, DB.products.findIndex(p => p.model === model)); renderApp();
};

/* ---- 功能模块划分表 / 维护责任人维护（以功能模块名称为标识，不再维护模块编号） ---- */
function applyModuleOwner(name, owner) {
  if (!can('manage')) { toast(`当前账号（${DB.currentUser} · ${DB.currentRole}）无「用例管理」权限`, 'error'); return; }
  const m = DB.stdModules.find(x => x.name === name);
  if (!m) return;
  m.owner = owner;
  if (!DB.deptMembers.includes(owner)) DB.deptMembers.push(owner);
  log('设置模块维护责任人', `${m.name} → ${owner}`);
  save(); renderApp(); toast('已设置责任人：' + owner);
}
window.gotoModuleOwner = function (name) {
  const m = DB.stdModules.find(x => x.name === name);
  if (!m) { if (!ensureTab('std')) return; state.tab = 'std'; renderApp(); toast('请先在模块划分表中新增该功能模块'); return; }
  openModuleOwner(m.name);
};
window.openModuleOwner = function (name) {
  if (!guard('manage', '用例管理')) return;
  const m = DB.stdModules.find(x => x.name === name);
  if (!m) return;
  formModal(`设置维护责任人 · ${m.name}`, [
    { key: 'owner', label: '维护责任人（部门成员）', type: 'select', options: ['未指定'].concat(DB.deptMembers), value: m.owner || '未指定' },
    { key: 'newOwner', label: '或输入新责任人姓名', type: 'text' }
  ], v => {
    const owner = (v.newOwner || '').trim() || (v.owner === '未指定' ? '' : v.owner);
    if (!owner) { toast('请选择或输入维护责任人'); return false; }
    applyModuleOwner(m.name, owner);
  });
};
window.openModuleManage = function () {
  if (!guard('manage', '用例管理')) return;
  const body = () => DB.stdModules.map((m, i) => {
    const caseCnt = DB.stdCases.filter(c => c.module === m.name).length;
    const branchCnt = Array.from(new Set(DB.stdCases.filter(c => c.module === m.name).map(c => c.branch))).length;
    const opts = '<option value="">未指定</option>' + DB.deptMembers.map(d => `<option ${d === m.owner ? 'selected' : ''}>${d}</option>`).join('');
    return `<tr>
      <td><b>${m.name}</b></td>
      <td>${m.domain}</td>
      <td><select id="o_${i}">${opts}</select></td>
      <td><input id="n_${i}" placeholder="新增姓名" style="width:120px"></td>
      <td>${caseCnt}</td>
      <td>${branchCnt}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="saveModuleOwnerRow(${i})">保存</button>
        <button class="btn btn-danger btn-sm" onclick="delModule(${i})">删除</button>
      </td>
    </tr>`;
  }).join('');
  modal('功能模块划分表 / 维护责任人设置', `
    
    <div class="table-wrap" style="max-height:46vh">
      <table><thead><tr><th>功能模块</th><th>领域</th><th>维护责任人（部门成员）</th><th>或新增责任人</th><th>用例数</th><th>分支数</th><th>操作</th></tr></thead>
      <tbody>${body()}</tbody></table>
    </div>
    <h4 style="margin:16px 0 8px">新增功能模块</h4>
    <div class="form" style="grid-template-columns:1.2fr .8fr 1fr 1fr">
      <div class="field"><label>模块名称</label><input id="nm_name"></div>
      <div class="field"><label>领域</label><select id="nm_domain">${domainOptions(DB.stdModules.map(m => m.domain)).map(d => `<option>${d}</option>`).join('')}</select></div>
      <div class="field"><label>维护责任人</label><select id="nm_owner"><option value="">未指定</option>${DB.deptMembers.map(d => `<option>${d}</option>`).join('')}</select></div>
      <div class="field"><label>或新增责任人</label><input id="nm_new"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" id="addModule">新增模块</button>
      <button class="btn btn-ghost" onclick="closeTopModal()">关闭</button>
    </div>
  `);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1400px, 92vw)';
  $('#addModule').onclick = () => {
    const name = $('#nm_name').value.trim();
    const owner = $('#nm_new').value.trim() || $('#nm_owner').value;
    if (!name) { toast('请填写模块名称'); return; }
    if (DB.stdModules.some(m => m.name === name)) { toast('该功能模块已存在'); return; }
    DB.stdModules.push({ name, domain: $('#nm_domain').value, owner: owner || '' });
    if (owner && !DB.deptMembers.includes(owner)) DB.deptMembers.push(owner);
    log('新增功能模块', `${name}｜责任人 ${owner || '未指定'}`);
    save(); closeTopModal(); renderApp(); openModuleManage(); toast('已新增功能模块：' + name);
  };
};
window.saveModuleOwnerRow = function (idx) {
  if (!guard('manage', '用例管理')) return;
  const m = DB.stdModules[idx];
  if (!m) return;
  const sel = $('#o_' + idx), nw = $('#n_' + idx);
  const owner = (nw && nw.value.trim()) || (sel ? sel.value : '');
  if (!owner) { toast('请选择或输入维护责任人'); return; }
  applyModuleOwner(m.name, owner);
  closeTopModal(); openModuleManage();
};
window.delModule = function (idx) {
  if (!guard('manage', '用例管理')) return;
  const m = DB.stdModules[idx];
  if (!m) return;
  const caseCnt = DB.stdCases.filter(c => c.module === m.name).length;
  confirmModal('删除功能模块', `<p>确定删除功能模块 <b>${m.name}</b>？</p>
  ${caseCnt ? `<p style="color:#e74c3c">该模块下仍有 ${caseCnt} 条用例，删除后这些用例将失去模块归属。</p>` : ''}`, () => {
  DB.stdModules = DB.stdModules.filter(x => x !== m);
  /* 删除名单：避免开库时的「模块缺失自愈」把这个模块重新登记回来 */
  DB.delModules = DB.delModules || [];
  if (DB.delModules.indexOf(m.name) < 0) DB.delModules.push(m.name);
  log('删除功能模块', m.name);
  save(); closeTopModal(); renderApp(); openModuleManage(); toast('已删除');
  });
};

/* 模块用例表单：功能模块支持自定义填写；分支类型联动适用产品型号（产品通用隐藏，指定产品展示且支持自定义型号） */
function stdCaseForm(existing, onSubmit) {
  const isEdit = !!existing;
  const c = existing || {};
  const mods = DB.stdModules.map(m => m.name);
  const models = Array.from(new Set(DB.products.map(p => p.model).concat(['USR-N580', 'USR-DR404'])));
  const curBranch = normBranch(c.branch);
  const isCommon = curBranch === '产品通用';
  const curProducts = splitModels(c.refProducts);
  const customProducts = curProducts.filter(x => models.indexOf(x) < 0);
  /* 用例领域默认值：编辑取当前值；新建按所属功能模块领域推导（仍在四个选项内） */
  const defaultDomain = normDomain(c.domain, normDomain((DB.stdModules.find(m => m.name === c.module) || {}).domain, '固件'));
  /* 用例状态是否锁定：新建固定「新增」；处于「新增 / 回退」的用例状态由审核流程控制，不允许手工改为「正常」 */
  const statusLocked = !isEdit || ['新增', '回退'].includes(c.status || '');
  const statusValue = isEdit ? (c.status || '正常') : '新增';
  const field = (label, inner, hint) => `<div class="field"><label>${label}</label>${inner}${hint ? `<small style="color:#8a9aab">${hint}</small>` : ''}</div>`;
  modal(isEdit ? `编辑模块用例 · ${stdCaseNoLabel(c)}` : '新建模块用例（模块用例库）', `
    
    <div class="form" style="grid-template-columns:1.3fr .8fr .9fr">
      ${field('功能模块（支持自定义填写）', `<input id="cf_module" list="cf_modlist" value="${c.module || ''}" placeholder="选择或直接输入新模块名称">
        <datalist id="cf_modlist">${mods.map(m => `<option value="${m}"></option>`).join('')}</datalist>`)}
      ${field('用例领域', `<select id="cf_caseDomain">${DOMAIN_OPTIONS.map(d => `<option ${((c.domain || defaultDomain) === d) ? 'selected' : ''}>${d}</option>`).join('')}</select>`)}
      ${field('分支类型', `<select id="cf_branch">${['产品通用', '指定产品'].map(b => `<option value="${b}" ${(isCommon ? b === '产品通用' : b === '指定产品') ? 'selected' : ''}>${b}</option>`).join('')}</select>`)}
    </div>
    <div class="form" style="grid-template-columns:1fr">
      ${field('适用产品型号', `<div id="cf_prodBox" class="multi">${models.map(m => `<label><input type="checkbox" class="cfprod" value="${m}" ${curProducts.indexOf(m) >= 0 ? 'checked' : ''}> ${m}</label>`).join('')}</div>
        <input id="cf_prodOther" placeholder="其他型号（自定义填写，多个用「、」逗号 斜杠分隔）" value="${customProducts.join('、')}" style="margin-top:6px">
`)}
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr 1fr">
      ${field('用例等级', `<select id="cf_level">${['L1', 'L2', 'L3'].map(l => `<option ${((c.level || 'L3') === l) ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${field('用例状态', `<select id="cf_status" ${statusLocked ? 'disabled' : ''} title="${statusLocked ? '状态由审核流程控制' : ''}">${(statusLocked ? [statusValue] : ['正常', '停用']).map(s => `<option ${statusValue === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
      ${field('手动测试时间（min）', `<input id="cf_minutes" type="number" value="${c.minutes == null ? '' : c.minutes}">`)}
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr 1fr">
      ${field('用例来源', `<select id="cf_source">${SOURCE_OPTIONS.map(s => `<option ${((c.source || '需求') === s) ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
      ${field('测试类型', `<select id="cf_testType">${['功能测试', '易用性测试', '兼容性测试', '性能测试', '可靠性测试', '安全测试'].map(t => `<option ${((c.testType || '功能测试') === t) ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
      ${field('自动化标志', `<select id="cf_autoFlag">${['否', '是'].map(a => `<option ${((c.autoFlag || '否') === a) ? 'selected' : ''}>${a}</option>`).join('')}</select>`)}
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr 1fr">
      ${field('自动化工具', `<input id="cf_autoTool" value="${(c.autoFlag === '是' ? (c.autoTool || '') : '')}" placeholder="如 AUTO-RobotFramework">`)}
      ${field('自动化测试时间（min）', `<input id="cf_autoTime" type="number" value="${(c.autoFlag === '是' && c.autoTime && c.autoTime !== '—' ? c.autoTime : '')}">`)}
      ${field('自动化状态更新时间', `<input id="cf_autoUpdatedAt" value="—" disabled>`)}
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr">
      ${field('功能点', `<input id="cf_fp" value="${c.functionPoint || ''}">`)}
      ${field('测试点', `<input id="cf_tp" value="${c.testPoint || '人机交互'}">`)}
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr 1fr">
      ${field('测试项目', `<input id="cf_testProject" value="${c.testProject || ''}" placeholder="不填默认取功能模块名称">`)}
      ${field('市场反馈 BUG', `<input id="cf_marketBug" value="${c.marketBug || ''}" placeholder="市场问题单号 / BUG 编号">`)}
      ${field('市场反馈时间', `<input id="cf_marketBugDate" value="${c.marketBugDate || ''}" placeholder="YYYY-MM-DD">`)}
    </div>
    <div class="form" style="grid-template-columns:1fr">
      ${field('用例概述', `<input id="cf_summary" value="${c.summary || ''}">`)}
      ${field('前置条件', `<textarea id="cf_pre" rows="2">${c.pre || ''}</textarea>`)}
      ${field('详细概述 / 操作步骤', `<textarea id="cf_steps" rows="3">${c.steps || ''}</textarea>`)}
      ${field('输入数据', `<input id="cf_input" value="${c.input || '无'}">`)}
      ${field('预期结果 / 测试标准', `<textarea id="cf_expect" rows="2">${c.expect || ''}</textarea>`)}
      ${field('备注', `<input id="cf_remark" value="${c.remark || '无'}">`)}
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="cfOk">${isEdit ? '保存修改' : '创建模块用例'}</button>
    </div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1120px, 94vw)';
  const syncBranch = () => {
    const common = $('#cf_branch').value === '产品通用';
    $$('.cfprod').forEach(i => { i.disabled = common; if (common) i.checked = false; });
    $('#cf_prodOther').disabled = common;
    if (common) $('#cf_prodOther').value = '';
    /* 分支类型为「产品通用」时整行隐藏「适用产品型号」，切换为「指定产品」后再带动效展示 */
    toggleReveal($('#cf_prodBox').closest('.form'), !common);
  };
  $('#cf_branch').onchange = syncBranch;
  syncBranch();
  /* 自动化联动：标志为「否」时隐藏自动化工具 / 自动化测试时间 / 自动化状态更新时间整行，为「是」时展示 */
  const syncAuto = () => {
    const on = $('#cf_autoFlag').value === '是';
    $('#cf_autoTool').disabled = !on;
    $('#cf_autoTime').disabled = !on;
    if (!on) { $('#cf_autoTool').value = ''; $('#cf_autoTime').value = ''; }
    /* 自动化标志为「否」时整行隐藏（自动化工具 / 自动化测试时间 / 自动化状态更新时间），选「是」时带动效展开 */
    toggleReveal($('#cf_autoTool').closest('.form'), on);
    $('#cf_autoUpdatedAt').value = on ? `保存时自动更新（当前 ${today()}）` : '—';
  };
  $('#cf_autoFlag').onchange = syncAuto;
  syncAuto();
  /* 市场反馈联动：用例来源为「市场问题」时展示并必填；其他来源隐藏并清空 */
  const syncMarket = () => {
    const on = $('#cf_source').value === '市场问题';
    const bug = $('#cf_marketBug'), date = $('#cf_marketBugDate');
    bug.disabled = !on; date.disabled = !on;
    if (!on) { bug.value = ''; date.value = ''; }
    /* 用例来源不是「市场问题」时隐藏两项市场反馈字段，选择「市场问题」后再带动效展示 */
    [bug, date].forEach(el => toggleReveal(el.closest('.field'), on));
  };
  $('#cf_source').onchange = syncMarket;
  syncMarket();
  $('#cfOk').onclick = () => {
    const module = $('#cf_module').value.trim();
    if (!module) { toast('请填写功能模块'); return; }
    const common = $('#cf_branch').value === '产品通用';
    const picked = $$('.cfprod').filter(i => i.checked).map(i => i.value);
    const other = $('#cf_prodOther').value.split(/[,，、;；|/／\s]+/).filter(Boolean);
    const products = common ? [] : Array.from(new Set(picked.concat(other)));
    if (!common && !products.length) { toast('分支类型为「指定产品」时，请至少指定一个适用产品型号'); return; }
    const summary = $('#cf_summary').value.trim();
    if (!summary) { toast('请填写用例概述'); return; }
    let newModule = null;
    if (!DB.stdModules.some(m => m.name === module)) {
      /* 自定义新模块时，模块领域直接取用例领域（不再单设「模块领域」字段） */
      const domain = $('#cf_caseDomain').value;
      newModule = { name: module, domain, owner: DB.currentUser };
      DB.stdModules.push(newModule);
      if (!DB.deptMembers.includes(DB.currentUser)) DB.deptMembers.push(DB.currentUser);
    }
    /* 分支类型固定两项取值：产品通用 / 指定产品（不再把型号拼进分支名） */
    const branch = common ? '产品通用' : '指定产品';
    const autoOn = $('#cf_autoFlag').value === '是';
    /* 用例来源为「市场问题」时，市场反馈 BUG 与市场反馈时间必填；其他来源这两项一律置空 */
    const source = $('#cf_source').value;
    const marketOn = source === '市场问题';
    const marketBug = marketOn ? $('#cf_marketBug').value.trim() : '';
    const marketBugDate = marketOn ? $('#cf_marketBugDate').value.trim() : '';
    if (marketOn && (!marketBug || !marketBugDate)) {
      toast('用例来源为「市场问题」时，市场反馈 BUG 与市场反馈时间必填');
      return;
    }
    onSubmit({
      module, branch, products, level: $('#cf_level').value, status: $('#cf_status').value,
      domain: $('#cf_caseDomain').value,
      functionPoint: $('#cf_fp').value, testPoint: $('#cf_tp').value, summary,
      pre: $('#cf_pre').value, steps: $('#cf_steps').value, input: $('#cf_input').value,
      expect: $('#cf_expect').value, remark: $('#cf_remark').value, minutes: $('#cf_minutes').value,
      testProject: $('#cf_testProject').value.trim(), marketBug, marketBugDate,
      source, testType: $('#cf_testType').value,
      autoFlag: $('#cf_autoFlag').value,
      autoTool: autoOn ? $('#cf_autoTool').value.trim() : '—',
      autoTime: autoOn ? $('#cf_autoTime').value : '—',
      autoUpdatedAt: autoOn ? today() : '—',
      newModule
    });
  };
}

/* 提交模块用例审核：选审批人 + 截止时间 → 生成审核单（用例状态「新增」，审核通过后入库并生成正式编号） */
window.submitCaseReview = function (caseIds, moduleNames, note) {
  const ids = (caseIds || []).filter(id => DB.stdCases.some(c => c.id === id));
  if (!ids.length) { toast('没有可提交审核的用例'); return; }
  const mods = Array.from(new Set((moduleNames || []).concat(ids.map(id => (DB.stdCases.find(c => c.id === id) || {}).module)).filter(Boolean)));
  /* 默认审批人：模块维护责任人 + 一级 / 最高管理员 */
  const owners = Array.from(new Set(mods.map(m => moduleOwner(m)).filter(Boolean)));
  const approvers = Array.from(new Set(owners
    .concat((DB.roles || []).filter(r => ['一级', '最高管理员'].includes(r.name)).flatMap(r => r.users || []))
    .concat(DB.deptMembers)));
  modal('提交模块用例审核', `
    
    <table class="detail-table">
      <tr><td style="width:110px">用例编号：</td><td style="white-space:normal">${ids.some(isPendingCaseId) ? `<span class="chip chip-warn">待编号</span> ${ids.some(id => !isPendingCaseId(id)) ? '；已编号：' + ids.filter(id => !isPendingCaseId(id)).join('、') : ''}` : ids.join('、')}</td></tr>
      <tr><td>所属模块：</td><td>${mods.join('、') || '—'}</td></tr>
      <tr><td>审批人：</td><td><div class="multi" id="srBox">${approvers.map(a => `<label><input type="checkbox" class="srcchk" value="${a}" ${owners.includes(a) || a === DB.currentUser ? 'checked' : ''}> ${a}${owners.includes(a) ? ' <span class="chip chip-info">模块责任人</span>' : ''}</label>`).join('')}</div></td></tr>
      <tr><td>审核截止时间：</td><td><input id="srDeadline" type="date" value="${addWorkDays(today(), 1)}"></td></tr>
      <tr><td>提交说明：</td><td><input id="srNote" style="width:100%" value="${note || `本次提交 ${ids.length} 条模块用例，请审核入库。`}"></td></tr>
    </table>
    <div class="form-actions">
      <span class="hint" style="margin:0" id="srTip"></span>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="srOk">提交审核</button>
    </div>`);
  const sync = () => { $('#srTip').textContent = `已选审批人 ${$$('.srcchk:checked').length} 人`; };
  $$('.srcchk').forEach(c => c.onchange = sync);
  sync();
  $('#srOk').onclick = () => {
    const picked = $$('.srcchk:checked').map(c => c.value);
    if (!picked.length) { toast('请至少选择一位审批人'); return; }
    const deadline = $('#srDeadline').value || addWorkDays(today(), 1);
    const rid = `MRV-2026-${String((DB.moduleReviews || []).length + 21).padStart(4, '0')}`;
    DB.moduleReviews.unshift({
      id: rid, type: '测试用例',
      target: `${mods.slice(0, 3).join('、')}${mods.length > 3 ? ' 等' : ''}（新建用例 ${ids.length} 条）`,
      module: mods[0], submitter: DB.currentUser, submitDate: today(), deadline,
      scope: '部门内（模块用例审核）', status: '待审核', participants: picked, opinions: [],
      caseIds: ids, note: $('#srNote').value.trim()
    });
    ids.forEach(id => {
      const c = DB.stdCases.find(x => x.id === id);
      if (!c) return;
      c.status = c.status === '停用' ? '停用' : '新增';
      c.reviewStatus = `待模块用例审核（${rid}）`;
      c.historyLog = `${c.historyLog || ''}；${today()} 提交模块用例审核（${rid}，审批人 ${picked.join('、')}）`;
    });
    /* 企业微信提醒（48/24/12 小时节点） */
    DB.notices = DB.notices || [];
    DB.notices.unshift({ time: nowStr(), to: picked.join('、'), type: '审核截止提醒', content: `模块用例审核 ${rid} 截止时间 ${deadline}（剩余 ${daysToDeadline(deadline)} 天），将在剩余 48/24/12 小时节点推送企业微信消息` });
    log('提交模块用例审核', `${rid}｜${ids.length} 条（${stdCaseNoListLabel(ids.slice(0, 5))}${ids.length > 5 ? ' …' : ''}）｜审批人 ${picked.join('、')}｜截止 ${deadline}`);
    save();
    closeAllModals();
    /* 提交后留在原页（模块用例库），不跳转审核中心：新建用例常是连续录入多条，
       每建一条就被拽走一次很打断操作。审核单已生成、用例状态为「新增（待审核）」，
       需要看审批进度时从「审核中心」页签进入即可（reviewTab 预置为模块用例，进去就是这一栏）。 */
    state.reviewTab = 'module';
    renderApp();
    toast(`已提交审核（${rid}），审核通过后自动入库并生成正式编号（进度见「审核中心」）`, 'success');
  };
};
window.newStdCase = function () {
  if (!guard('edit')) return;
  stdCaseForm(null, v => {
    /* 新建用例直接入库但状态为「新增（待审核）」：不占用正式编号，审核通过时才发号 */
    const id = nextPendingCaseId();
    DB.stdCases.unshift({
      id, level: v.level, module: v.module, branch: v.branch, domain: normDomain(v.domain, '固件'),
      functionPoint: v.functionPoint, testPoint: v.testPoint,
      summary: v.summary, designer: DB.currentUser, status: '新增', refProducts: splitModels(v.products),
      pre: v.pre, steps: v.steps, input: v.input, expect: v.expect, remark: v.remark, minutes: v.minutes,
      source: v.source, designDate: today(), updater: DB.currentUser, updateDate: today(),
      testType: v.testType, testProject: v.testProject || v.module, reuse: 0,
      autoFlag: v.autoFlag, autoTool: v.autoTool, autoTime: v.autoTime, autoUpdatedAt: v.autoUpdatedAt,
      bugCount: 0, bugIds: [], marketBug: v.marketBug || '', marketBugDate: v.marketBugDate || '', bugId: '—',
      reviewStatus: '待提交模块用例审核',
      historyLog: `${today()} 由 ${DB.currentUser} 新建（状态：新增，待审核入库）`,
      log: `首次创建：新增（${DB.currentUser}）`
    });
    if (v.newModule) log('新增功能模块', `${v.newModule.name}｜责任人 ${v.newModule.owner}（新建模块用例时自动创建）`);
    log('新建模块用例（待审核）', `${id}｜${v.module}｜${v.branch}｜适用产品 ${v.products.length ? v.products.join('、') : '不限型号'}｜状态：新增，待审核入库`,
      '', { module: '用例库', objType: '模块用例', objId: id });
    save();
    closeTopModal();
    renderStd();
    toast(`用例 ${id} 已保存为「新增」状态，请提交审核后入库`, 'success');
    /* 不允许直接入库：立即走模块用例审核流程 */
    submitCaseReview([id], [v.module]);
  });
};

window.disableStd = function () {
  if (!guard('edit')) return;
  const picked = $$('.rowchk:checked').map(x => x.value);
  if (!picked.length) { toast('请先勾选要停用的用例'); return; }
  const invalid = picked.filter(id => (DB.stdCases.find(c => c.id === id) || {}).status === '停用');
  formModal(`停用用例（已勾选 ${picked.length} 条）`, [{ key: 'reason', label: '停用原因（必填，规范要求留痕）', type: 'textarea', value: '' }], v => {
    if (!v.reason.trim()) { toast('请填写停用原因'); return false; }
    let n = 0;
    const details = [], changes = [];
    picked.forEach(id => {
      const c = DB.stdCases.find(x => x.id === id);
      if (!c || c.status === '停用') return;
      const diff = diffCaseFields(c, Object.assign({}, c, { status: '停用' }));
      c.status = '停用'; c.disableReason = v.reason; c.disableDate = today(); n++;
      details.push(`${stdCaseNoLabel(c)}（${c.module}）`);
      changes.push({ field: '用例状态', from: '正常', to: `停用（${stdCaseNoLabel(c)}）` });
      c.historyLog = `${c.historyLog || ''}；${today()} 停用（${DB.currentUser}）：${diff || '用例状态不变'}；停用原因「${briefLogText(v.reason, 60)}」`;
    });
    const refs = DB.products.filter(p => (p.refs || []).some(r => (r.caseIds || []).some(id => picked.includes(id)))).map(p => p.model);
    log('停用模块用例', `${details.join('、') || picked.join('、')}｜原因：${briefLogText(v.reason, 80)}${refs.length ? `｜被引用产品：${refs.join('、')}（需同步处理）` : ''}`,
      '', { module: '用例库', objType: '模块用例', objId: picked.join(','), changes });
    state.selected = []; closeTopModal(); renderStd();
    toast(`已停用 ${n} 条用例` + (invalid.length ? `（${invalid.length} 条本就停用）` : ''), 'success');
  });
};

window.enableStd = function () {
  if (!guard('edit')) return;
  const picked = $$('.rowchk:checked').map(x => x.value).filter(id => (DB.stdCases.find(c => c.id === id) || {}).status === '停用');
  if (!picked.length) { toast('请勾选状态为「停用」的用例后再启用'); return; }
  const changes = [];
  picked.forEach(id => {
    const c = DB.stdCases.find(x => x.id === id);
    if (!c) return;
    const diff = diffCaseFields(c, Object.assign({}, c, { status: '正常' }));
    c.status = '正常';
    changes.push({ field: '用例状态', from: `停用（${stdCaseNoLabel(c)}${c.disableReason ? '，原因：' + briefLogText(c.disableReason, 30) : ''}）`, to: '正常' });
    c.historyLog = `${c.historyLog || ''}；${today()} 启用（${DB.currentUser}）：${diff || '用例状态不变'}（原停用原因「${briefLogText(c.disableReason, 40)}」作废）`;
    delete c.disableReason; delete c.disableDate;
  });
  log('启用模块用例', `${picked.join('、')}（状态恢复为正常）`, '', { module: '用例库', objType: '模块用例', objId: picked.join(','), changes });
  state.selected = []; renderStd(); toast(`已启用 ${picked.length} 条用例`, 'success');
};

/* 导出申请审批：一级 / 二级权限人员发起导出申请 → 一级权限人员审批 → 通过后生成 CSV 下载 */
window.exportStd = function () {
  if (!guard('export')) return;
  const list = filteredStdCases();
  const approvers = Array.from(new Set((DB.roles || []).filter(r => r.name === '一级' || r.name === '最高管理员').flatMap(r => r.users || []).concat(DB.deptMembers)));
  modal('导出申请（导出需审批）', `
    
    <table class="detail-table">
      <tr><td style="width:110px">导出范围：</td><td><b id="exRange">${list.length}</b> 条（当前筛选结果，全库 ${DB.stdCases.length} 条）</td></tr>
      <tr><td>导出原因：</td><td><input id="exReason" style="width:100%" value="用例评审交付，需导出模块用例库当前筛选结果。"></td></tr>
      <tr><td>审批人：</td><td><div class="multi" id="exBox">${approvers.map(a => `<label><input type="checkbox" class="exchk" value="${a}" ${a === DB.currentUser ? 'checked' : ''}> ${a}</label>`).join('')}</div></td></tr>
      <tr><td>审批截止时间：</td><td><input id="exDeadline" type="datetime-local" value="${today()}T18:00"></td></tr>
    </table>
    <div class="form-actions">
      <span class="hint" style="margin:0" id="exTip"></span>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="exOk">提交申请</button>
    </div>`);
  const sync = () => { $('#exTip').textContent = `已选审批人 ${$$('.exchk:checked').length} 人`; };
  $$('.exchk').forEach(c => c.onchange = sync);
  sync();
  $('#exOk').onclick = () => {
    const picked = $$('.exchk:checked').map(c => c.value);
    if (!picked.length) { toast('请至少选择一位审批人'); return; }
    const deadline = ($('#exDeadline').value || '').slice(0, 16) || `${today()} 18:00`;
    DB.exportRequests = DB.exportRequests || [];
    DB.exportRequests.unshift({
      id: `EX-2026-${String(DB.exportRequests.length + 21).padStart(4, '0')}`,
      type: '模块用例库导出', scope: `当前筛选结果 ${list.length} 条`, count: list.length,
      /* 锁定申请时的用例集合：审批通过后由申请人导出，按此集合导出，条数与审批时一致 */
      caseIds: list.map(c => c.id),
      applicant: DB.currentUser, approvers: picked, reason: $('#exReason').value.trim() || '—',
      deadline, submitDate: today(), submitAt: nowStr(), status: '审批中', opinion: '', filterDesc: filterDescOf()
    });
    DB.notices = DB.notices || [];
    DB.notices.unshift({ time: nowStr(), to: picked.join('、'), type: '导出审批截止提醒', content: `导出申请审批截止时间 ${deadline}，剩余 ${daysToDeadline(deadline.slice(0, 10))} 天，将在 48/24/12 小时节点推送企业微信消息` });
    log('导出申请', `模块用例库 ${list.length} 条｜审批人 ${picked.join('、')}｜截止 ${deadline}`);
    closeTopModal(); renderApp();
    toast('导出申请已提交，待审批人审批', 'success');
  };
};
function filterDescOf() {
  const f = [];
  const levels = asList(state.stdLevel), mods = asList(state.stdModule), models = asList(state.stdModel);
  if (state.stdKeyword) f.push(`关键字=${state.stdKeyword}`);
  if (levels.length) f.push(`等级=${levels.join('、')}`);
  if (mods.length) f.push(`模块=${mods.join('、')}`);
  if (models.length) f.push(`适用产品型号=${models.join('、')}`);
  if (state.stdModuleKw) f.push(`模块关键字=${state.stdModuleKw}`);
  if (state.stdShowOff) f.push('仅显示停用');
  return f.length ? f.join('；') : '全部用例';
}
function exportXlsxByName() { return `模块用例库_${ymd()}.xlsx`; }
/* 模块用例导出的列：固定为「模块用例库全部字段」，不跟随列表的「筛选列」设置。
   导出文件是交给他人/归档用的，缺少字段会造成信息丢失；只有「操作」列是纯界面交互，需排除。 */
function stdExportAllCols() { return STD_FIELDS.filter(f => f.key !== 'ops'); }
/* 模块用例导出（Excel）：全字段 + 当前筛选结果
   ids 传入时以该用例集合为准（导出申请审批通过后由申请人导出，期间筛选条件可能已变化，
   必须按申请时锁定的集合导出，保证「审批的条数」与「导出的条数」一致）。
   desc 传入时用于「导出说明」的筛选条件文案（取申请时记录的条件） */
function stdExportSheets(ids, desc) {
  const cols = stdExportAllCols();
  const list = ids && ids.length ? ids.map(id => stdCaseById(id)).filter(Boolean) : filteredStdCases();
  return {
    count: list.length,
    sheets: [
      { name: '模块用例', rows: xlsxRowsFrom(cols, list) },
      {
        name: '导出说明', rows: [
          ['导出时间', nowStr()], ['用例条数', String(list.length)],
          ['筛选条件', desc || filterDescOf()],
          ['导出字段', `全字段导出（${cols.length} 个字段，不含「操作」）`],
          ['字段清单', cols.map(f => f.label).join(' / ')]
        ]
      }
    ]
  };
}
async function doExportStd(ids, desc) {
  const r = stdExportSheets(ids, desc);
  await downloadXlsx(exportXlsxByName(), r.sheets);
  return r.count;
}
/* 导出审批：审批人只负责「通过 / 驳回」。
   通过后流程回到申请人（发起导出的人）本人，由申请人点击「导出」下载文件 ——
   审批人不得替申请人下载，否则申请人（A）拿不到文件、流程也不会回到 A。 */
window.approveExport = function (id, ok) {
  const r = (DB.exportRequests || []).find(x => x.id === id);
  if (!r) return;
  if (r.status !== '审批中') { toast(`该申请已是「${r.status}」，无需重复处理`); return; }
  if (ok) {
    r.status = '待申请人导出';
    r.approvedBy = DB.currentUser; r.approvedAt = nowStr();
    r.opinion = `${DB.currentUser} 审批通过（${nowStr()}），待申请人 ${r.applicant} 导出`;
    DB.notices = DB.notices || [];
    DB.notices.unshift({
      time: nowStr(), to: r.applicant, type: '导出申请已通过',
      content: `导出申请 ${r.id}（${r.type}｜${r.count} 条）已由 ${DB.currentUser} 审批通过，流程已回到你处，请在「我的待办 / 审核中心 → 待我导出」点击「导出 Excel」下载文件`
    });
    log('导出申请通过', `${r.id}｜申请人 ${r.applicant}｜审批人 ${DB.currentUser}｜${r.count} 条｜流程回到申请人待导出`);
    closeTopModal(); renderApp();
    toast(`审批通过，已通知申请人 ${r.applicant} 导出（文件由申请人下载）`, 'success');
  } else {
    modal('驳回导出申请 · ' + r.id, `
      <table class="detail-table"><tr><td style="width:90px">驳回原因：</td><td><input id="rjReason" style="width:100%" value="导出范围需调整为…"></td></tr></table>
      <div class="form-actions"><button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="rjOk">确认驳回</button></div>`);
    $('#rjOk').onclick = () => {
      r.status = '已驳回'; r.approvedBy = DB.currentUser; r.approvedAt = nowStr();
      r.opinion = `${DB.currentUser} 驳回：${$('#rjReason').value.trim() || '—'}`;
      DB.notices = DB.notices || [];
      DB.notices.unshift({ time: nowStr(), to: r.applicant, type: '导出申请已驳回', content: `导出申请 ${r.id}（${r.type}）被 ${DB.currentUser} 驳回：${$('#rjReason').value.trim() || '—'}，流程已回到你处，可修改后重新发起申请` });
      log('导出申请驳回', `${r.id}｜${r.applicant}｜${r.opinion}`);
      closeTopModal(); renderApp(); toast('已驳回该导出申请，已通知申请人');
    };
  }
};
/* 待我导出的申请：审批已通过、申请人本人尚未下载文件的导出申请（流程停在申请人这里） */
function myExportTodos() {
  return (DB.exportRequests || []).filter(r => r.status === '待申请人导出' && r.applicant === DB.currentUser);
}
/* 申请人本人下载：仅申请人可执行，导出范围取申请时锁定的用例集合 */
window.exportApprovedRequest = async function (id) {
  const r = (DB.exportRequests || []).find(x => x.id === id);
  if (!r) return;
  if (r.status === '审批中') { toast('该申请仍在审批中，审批通过后才能导出'); return; }
  if (r.status !== '待申请人导出') { toast(`该申请已是「${r.status}」，无需重复导出`); return; }
  if (r.applicant !== DB.currentUser) { toast(`仅申请人 ${r.applicant} 可导出该文件（文件归属申请人）`); return; }
  const isProd = String(r.type || '').indexOf('产品用例库') === 0;
  let n = 0;
  try {
    n = isProd ? await exportProdXlsx(r.product, r.caseIds) : await doExportStd(r.caseIds, r.filterDesc);
  } catch (e) { toast('导出失败：' + (e && e.message ? e.message : e), 'error'); return; }
  r.status = '已完成'; r.exportedBy = DB.currentUser; r.exportedAt = nowStr(); r.exportCount = n;
  log('导出文件下载', `${r.id}｜申请人 ${r.applicant}（本人导出）｜${n} 条｜${isProd ? `产品用例库_${r.product}_${ymd()}.xlsx` : exportXlsxByName()}`);
  redrawKeepView();
  toast(`已导出 ${n} 条（Excel）`, 'success');
};
/* 「待我导出」面板：我的待办 / 审核中心共用，提醒申请人审批已通过、可下载文件 */
function exportTodoPanelHtml() {
  const list = myExportTodos();
  return `<div class="panel">
    <div class="panel-header">
      <h2 class="panel-title">待我导出（审批已通过） <span class="chip">${list.length}</span></h2>
    </div>
    <div class="table-wrap">
      <table><thead><tr><th>申请单号</th><th>导出类型</th><th>范围 / 条数</th><th>审批人</th><th>审批通过时间</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td>${r.id}</td><td>${r.type}</td><td>${r.scope}</td><td>${r.approvedBy || '—'}</td>
        <td>${r.approvedAt || '—'}</td><td>${pill(r.status)}</td>
        <td><span class="link" onclick="exportApprovedRequest('${r.id}')">导出 Excel</span></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty">暂无待导出申请</td></tr>'}</tbody></table>
    </div>
  </div>`;
}
/* 「待我导出」提醒条：申请人停留在模块 / 产品用例库时也能立刻看到审批已通过、需要本人下载 */
function exportTodoBannerHtml() {
  const list = myExportTodos();
  if (!list.length) return '';
  const total = list.reduce((a, r) => a + (r.count || 0), 0);
  return `<div class="hint" style="background:#eef6ff;border:1px solid #cfe3ff;border-radius:8px;padding:9px 14px;margin-bottom:12px">
    导出审批已通过，流程已回到你处：<b>${list.map(r => r.id).join('、')}</b>（共 ${total} 条）
    <span class="link" onclick="exportApprovedRequest('${list[0].id}')">立即导出 Excel</span>
    <span class="link" onclick="state.tab='todo';renderApp()">前往「我的待办」</span>
  </div>`;
}

/* ---------- 用例历史 log：记录字段级变更（原内容 → 现内容） ---------- */
/* 参与变更记录的用例字段（顺序即日志中的展示顺序） */
const STD_LOG_FIELDS = [
  ['module', '功能模块'], ['domain', '用例领域'], ['branch', '分支类型'], ['refProducts', '适用产品型号'], ['level', '用例等级'],
  ['status', '用例状态'], ['source', '用例来源'], ['testType', '测试类型'], ['functionPoint', '功能点'],
  ['testPoint', '测试点'], ['summary', '用例概述'], ['pre', '前置条件'], ['steps', '详细概述 / 操作步骤'],
  ['input', '输入数据'], ['expect', '预期结果 / 测试标准'], ['remark', '备注'], ['minutes', '手动测试时间(min)'],
  ['testProject', '测试项目'], ['marketBug', '市场反馈 BUG'], ['marketBugDate', '市场反馈时间'],
  ['autoFlag', '自动化标志'], ['autoTool', '自动化工具'], ['autoTime', '自动化测试时间(min)']
];
function logValueText(v) {
  if (Array.isArray(v)) return v.length ? v.join('、') : '通用（不限型号）';
  if (v == null || v === '') return '（空）';
  return String(v);
}
/* 日志内的值文本：压缩空白并限长，避免历史 log 被长描述撑爆 */
function briefLogText(v, max) {
  const t = logValueText(v).replace(/\s+/g, ' ').trim();
  const lim = max || 60;
  return t.length > lim ? t.slice(0, lim) + '…' : t;
}
/* 字段级差异：`字段「原值」→「现值」`，多项以「；」分隔；无变更返回空串（用例字段口径，见 STD_LOG_FIELDS） */
function diffCaseFields(before, after) {
  return changesText(diffFields(before, after, STD_LOG_FIELDS));
}
/* 产品信息字段（产品信息设置的字段级留痕口径） */
const PRODUCT_LOG_FIELDS = [
  ['model', '产品型号'], ['series', '产品系列'], ['domain', '领域'],
  ['owner', '产品测试主负责人'], ['planVersion', '产品用例版本'], ['members', '项目成员']
];
/* 执行任务字段（编辑执行任务时的留痕口径） */
const EXEC_LOG_FIELDS = [
  ['name', '执行任务名称'], ['model', '产品型号'], ['domain', '领域'], ['round', '轮数'],
  ['hwVersion', '硬件版本'], ['fwVersion', '固件版本'], ['executors', '执行人']
];
/* 执行明细可改字段（执行结果 / 备注 / 自动化 / 实际测试时间） */
const EXEC_FIELD_LABELS = {
  result: '执行结果', resultNote: '执行结果备注信息', auto: '是否自动化测试', actualTime: '实际测试时间(min)'
};
/* ---------- 用例详情：一律展示「全部字段」（不做精简） ---------- */
/* 取值：优先按列定义的 cell / get 渲染，取不到时回退原始值；plain=true 时不渲染输入类控件（只读详情用） */
function fieldValueHtml(f, o, plain) {
  try {
    if (!plain && f.cell) return f.cell(o);
    if (f.get) { const v = f.get(o); return v == null || v === '' ? '—' : String(v); }
  } catch (e) { }
  const v = o[f.key];
  return v == null || v === '' ? '—' : String(v);
}
/* 历史 log 分条展示（每条变更记录单独一行，便于逐条核对） */
function historyLogHtml(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return '—';
  return s.split('；').filter(x => x.trim()).map(x => `<div class="log-line">${x.trim()}</div>`).join('');
}
/* 模块用例全部字段（用例字段全量，操作列除外） */
function stdCaseAllFields(c) {
  return STD_FIELDS.filter(f => f.key !== 'ops').map(f => {
    if (f.key === 'historyLog') return [f.label, historyLogHtml(c.historyLog)];
    return [f.label, fieldValueHtml(f, c)];
  });
}
/* 产品用例全部字段（产品用例字段全量，操作列除外） */
function prodCaseAllFields(r) {
  return COL_SCHEMAS.prod.fields.filter(f => f.key !== 'ops').map(f => [f.label, fieldValueHtml(f, r)]);
}
/* 全部字段详情弹窗：支持多段（段标题仅多段时显示），字段多时弹窗内滚动 */
function allFieldsModal(title, sections, actions) {
  const list = sections.filter(s => s && s.rows && s.rows.length);
  const html = list.map(s => `
    ${list.length > 1 ? `<div class="detail-sec-title">${s.title}</div>` : ''}
    <table class="detail-table">${s.rows.map(([k, v]) => `<tr><td style="width:170px">${k}</td><td>${v == null || v === '' ? '—' : v}</td></tr>`).join('')}</table>`).join('');
  modal(title, `<div class="detail-all">${html}</div><div class="form-actions">${actions || ''}<button class="btn btn-ghost" onclick="closeTopModal()">关闭</button></div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1120px, 94vw)';
}
/* 按执行记录的用例编号回溯来源用例（模块用例 / 产品用例） */
function sourceCaseOfExecRow(e, r) {
  const cid = String(r.caseId || '');
  const prefix = String(e.model || '') + '-';
  const srcId = cid.indexOf(prefix) === 0 ? cid.slice(prefix.length) : cid;
  const sc = stdCaseById(srcId);
  if (sc) return { stdCase: sc };
  const p = DB.products.find(x => x.model === e.model);
  if (p) {
    const row = prodCaseRows(p).find(x => x.id === cid);
    if (row) return { prodRow: row, product: p };
  }
  return null;
}
window.openStdDetail = function (id) {
  const c = DB.stdCases.find(x => x.id === id);
  if (!c) return;
  allFieldsModal(`模块用例详情 · ${stdCaseNoLabel(c)}`,
    [{ title: '用例字段（全部）', rows: stdCaseAllFields(c) }],
    `<button class="btn btn-primary" onclick="closeTopModal();editStdCase('${c.id}')">编辑</button>`);
};
/* 产品用例详情：产品用例字段（全部）+ 源模块用例 / 来源产品用例字段（全部） */
window.openProdCaseDetail = function (model, id) {
  const p = DB.products.find(x => x.model === model);
  const row = p ? prodCaseRows(p).find(x => x.id === id) : null;
  if (!row) { toast('未找到该产品用例'); return; }
  const sections = [{ title: '产品用例字段（全部）', rows: prodCaseAllFields(row) }];
  const sc = row.stdCaseId ? stdCaseById(row.stdCaseId) : null;
  if (sc) {
    sections.push({ title: `源模块用例字段（全部）· ${stdCaseNoLabel(sc)}`, rows: stdCaseAllFields(sc) });
  } else if (row.source === '引用产品用例' && row.fromProduct) {
    const src = DB.products.find(x => x.model === row.fromProduct);
    const srcRow = src ? prodCaseRows(src).find(x => x.id === row.id) : null;
    if (srcRow) sections.push({ title: `来源产品用例字段（全部）· ${row.fromProduct}`, rows: prodCaseAllFields(srcRow) });
  }
  allFieldsModal(`产品用例详情 · ${row.id}`, sections, '');
};

window.editStdCase = function (id) {
  if (!guard('modify', '修改用例')) return;
  const c = DB.stdCases.find(x => x.id === id);
  if (!c) return;
  stdCaseForm(c, v => {
    /* 编辑前快照：用于生成字段级历史 log（原内容 → 现内容） */
    const before = Object.assign({}, c);
    Object.assign(c, {
      module: v.module, branch: v.branch, level: v.level, domain: normDomain(v.domain, c.domain),
      functionPoint: v.functionPoint, testPoint: v.testPoint,
      summary: v.summary, pre: v.pre, steps: v.steps, input: v.input, expect: v.expect, remark: v.remark,
      minutes: v.minutes, status: v.status, refProducts: splitModels(v.products),
      source: v.source, testType: v.testType, testProject: v.testProject || v.module,
      marketBug: v.marketBug || '', marketBugDate: v.marketBugDate || '',
      updater: DB.currentUser, updateDate: today(),
      autoFlag: v.autoFlag, autoTool: v.autoTool, autoTime: v.autoTime, autoUpdatedAt: v.autoUpdatedAt
    });
    if (v.status === '停用') { c.disableReason = c.disableReason || '编辑时标记停用'; c.disableDate = c.disableDate || today(); }
    if (v.newModule) log('新增功能模块', `${v.newModule.name}（编辑模块用例时自动创建）`);
    const changes = diffFields(before, c, STD_LOG_FIELDS);
    const diff = changesText(changes);
    c.historyLog = `${c.historyLog || ''}；${today()} 编辑更新（${DB.currentUser}）：${diff || '无字段变化'}`;
    /* 字段级留痕：逐字段「原值 → 现值」写进流程日志，便于按人 / 按用例追溯 */
    log('编辑模块用例', `${stdCaseNoLabel(c)}｜${c.module}｜${c.branch}｜状态 ${c.status}｜${diff || '无字段变化'}`,
      '', { module: '用例库', objType: '模块用例', objId: c.id, changes });
    closeTopModal(); renderStd(); toast('已保存修改', 'success');
  });
};

window.openStdStats = function () {
  const count = m => m === '全部' ? DB.stdCases.length : DB.stdCases.filter(c => c.module === m).length;
  const normal = m => m === '全部' ? DB.stdCases.filter(c => c.status === '正常').length : DB.stdCases.filter(c => c.module === m && c.status === '正常').length;
  const off = m => m === '全部' ? DB.stdCases.filter(c => c.status === '停用').length : DB.stdCases.filter(c => c.module === m && c.status === '停用').length;
  const rows = DB.stdModules.map(m => `<tr><td>${m.name}</td><td>${count(m.name)}</td><td>${normal(m.name)}</td><td>${off(m.name)}</td><td>${m.owner}</td></tr>`).join('')
    + `<tr style="font-weight:600"><td>合计</td><td>${count('全部')}</td><td>${normal('全部')}</td><td>${off('全部')}</td><td>—</td></tr>`;
  modal('模块用例统计', `<table class="detail-table"><thead><tr><th>功能模块</th><th>用例总数</th><th>正常</th><th>停用</th><th>维护责任人</th></tr></thead><tbody>${rows}</tbody></table>`);
};

/* ---------- 产品用例库 ---------- */
/* ---------- 产品用例库：左侧齐全度分析树（领域 / 产品线 / 产品型号 / 测试类型 / 功能模块 / 功能点 / 测试点） ---------- */
const PROD_TREE_LEVELS = [
  { key: 'series', label: '产品线' },
  { key: 'model', label: '产品型号' },
  { key: 'domain', label: '领域' },
  { key: 'testType', label: '测试类型' },
  { key: 'module', label: '功能模块' },
  { key: 'functionPoint', label: '功能点' },
  { key: 'testPoint', label: '测试点' }
];
const PROD_TREE_DEFAULT = ['series', 'model', 'domain', 'testType', 'module', 'functionPoint', 'testPoint'];
function prodTreeLevelDefs() {
  /* 按用户自定义的顺序返回已启用的层级（顺序即树的父级 → 子级） */
  return state.prodTreeLevels.map(k => PROD_TREE_LEVELS.find(l => l.key === k)).filter(Boolean);
}
function prodTreeLevelLabel(key) {
  const d = PROD_TREE_LEVELS.find(l => l.key === key);
  return d ? d.label : key;
}
function prodTreeKey(path) {
  return path.map(x => x.level + ':' + encodeURIComponent(x.value)).join('|');
}
function prodTreeDecode(key) {
  return String(key || '').split('|').filter(Boolean).map(s => {
    const i = s.indexOf(':');
    return { level: s.slice(0, i), value: decodeURIComponent(s.slice(i + 1)) };
  });
}
function prodTreeValue(row, level) {
  const v = row[level];
  return v == null || v === '' ? '—' : String(v);
}
/* 由用例抽取各层级取值，构建多级树（每个节点记录条数与路径） */
function buildProdTree(rows) {
  const levels = prodTreeLevelDefs().map(l => l.key);
  const root = { children: new Map(), count: 0, path: [] };
  rows.forEach(r => {
    let node = root;
    node.count++;
    levels.forEach(lv => {
      const v = prodTreeValue(r, lv);
      if (!node.children.has(v)) node.children.set(v, { value: v, children: new Map(), count: 0, path: node.path.concat([{ level: lv, value: v }]) });
      node = node.children.get(v);
      node.count++;
    });
  });
  return root;
}
/* 按当前筛选路径过滤用例 */
function prodTreeFiltered(rows) {
  const keys = Object.keys(state.prodTreePath);
  if (!keys.length) return rows;
  return rows.filter(r => keys.every(k => prodTreeValue(r, k) === String(state.prodTreePath[k])));
}
function prodTreeNodeActive(path) {
  return path.every(x => String(state.prodTreePath[x.level]) === String(x.value));
}
function pruneProdTree(node, kw) {
  const kept = [];
  Array.from(node.children.values()).forEach(c => {
    if (String(c.value).toLowerCase().indexOf(kw) >= 0) { kept.push(c); return; }
    pruneProdTree(c, kw);
    if (c.children.size) kept.push(c);
  });
  node.children = new Map(kept.map(c => [c.value, c]));
  return node;
}
function prodTreePanel(allRows, shownRows) {
  const kw = (state.prodTreeKw || '').trim().toLowerCase();
  const tree = buildProdTree(allRows);
  if (kw) pruneProdTree(tree, kw);
  const out = [];
  const walk = (node, depth) => {
    Array.from(node.children.values()).forEach(child => {
      const key = prodTreeKey(child.path);
      const hasKids = child.children.size > 0;
      const collapsed = kw ? false : (state.prodTreeCollapseAll ? depth > 0 : !!state.prodTreeCollapsed[key]);
      const active = prodTreeNodeActive(child.path);
      out.push(`<div class="tree-node${active ? ' active' : ''}" data-node="${key}" style="padding-left:${6 + depth * 13}px">
        <span class="tn-toggle" data-toggle="${key}">${hasKids ? (collapsed ? '▸' : '▾') : '·'}</span>
        <span class="tn-label" data-pick="${key}">${child.value}</span>
        <em>${child.count}</em></div>`);
      if (hasKids && !collapsed) walk(child, depth + 1);
    });
  };
  walk(tree, 0);
  const pathKeys = Object.keys(state.prodTreePath);
  const crumb = pathKeys.length
    ? pathKeys.map(k => `${prodTreeLevelLabel(k)}：${state.prodTreePath[k]}`).join('　›　')
    : '全部用例';
  const levels = prodTreeLevelDefs();
  return `
    <h4>用例齐全度分析</h4>
    <div class="prod-tree-tools">
      <span class="link" onclick="expandProdTree(true)">展开全部</span>
      <span class="link" onclick="expandProdTree(false)">收起全部</span>
      <span class="link" onclick="openProdTreeLevels()">层级设置</span>
      <span class="link" onclick="clearProdTree()">清除筛选</span>
    </div>
    <div class="prod-tree-levels">层级：${levels.map(l => l.label).join(' › ')}</div>
    <div class="prod-tree-crumb">筛选：<b>${crumb}</b>　<span class="chip">${shownRows.length} / ${allRows.length} 条</span></div>
    <input id="prodTreeKw" placeholder="搜索产品型号 / 节点名称" value="${state.prodTreeKw}">
    <div class="tree-list">${out.join('') || `<div class="empty" style="padding:12px">${kw ? '没有匹配的节点' : '该产品还没有用例，先点击「从模块用例库筛选用例」组合用例'}</div>`}</div>`;
}
function bindProdTree() {
  /* 仅绑定产品齐全度分析树的三角（[data-toggle]）；分支图的三角由 renderProd 单独绑定（[data-ctoggle]） */
  $$('.tn-toggle[data-toggle]').forEach(el => el.onclick = (ev) => {
    ev.stopPropagation();
    const key = el.dataset.toggle;
    if (state.prodTreeCollapseAll) state.prodTreeCollapseAll = false;
    if (state.prodTreeCollapsed[key]) delete state.prodTreeCollapsed[key];
    else state.prodTreeCollapsed[key] = true;
    renderProd();
  });
  $$('[data-pick]').forEach(el => el.onclick = () => {
    const path = prodTreeDecode(el.dataset.pick);
    const last = path[path.length - 1];
    if (prodTreeNodeActive(path) && String(state.prodTreePath[last.level]) === String(last.value)) {
      /* 再次点击同一节点 = 取消该级筛选（回到父级） */
      state.prodTreePath = {};
      path.slice(0, -1).forEach(x => { state.prodTreePath[x.level] = x.value; });
    } else {
      state.prodTreePath = {};
      path.forEach(x => { state.prodTreePath[x.level] = x.value; });
    }
    renderProd();
  });
}
window.clearProdTree = function () { state.prodTreePath = {}; renderProd(); };
window.expandProdTree = function (expand) {
  if (expand) {
    state.prodTreeCollapsed = {};
    state.prodTreeCollapseAll = false;
  } else {
    /* 收起时保留第一层，其余折叠 */
    const p = DB.products[state.prodIndex];
    const tree = buildProdTree(prodCaseRows(p));
    const next = {};
    const walk = (node, depth) => {
      Array.from(node.children.values()).forEach(c => {
        if (c.children.size) { next[prodTreeKey(c.path)] = true; walk(c, depth + 1); }
      });
    };
    walk(tree, 0);
    Array.from(tree.children.values()).forEach(c => { delete next[prodTreeKey(c.path)]; });
    state.prodTreeCollapsed = next;
    state.prodTreeCollapseAll = false;
  }
  renderProd();
};
/* 分析树层级自定义：勾选启用 + 上移/下移调整顺序（顺序即树的上下级层级） */
window.openProdTreeLevels = function () {
  let order = PROD_TREE_LEVELS.map(l => l.key).filter(k => state.prodTreeLevels.indexOf(k) >= 0)
    .concat(PROD_TREE_LEVELS.map(l => l.key).filter(k => state.prodTreeLevels.indexOf(k) < 0));
  const enabled = new Set(state.prodTreeLevels);
  const labelOf = k => (PROD_TREE_LEVELS.find(l => l.key === k) || { label: k }).label;
  const draw = () => {
    $('#tlList').innerHTML = order.map((k, i) => `
      <tr data-k="${k}" class="${enabled.has(k) ? '' : 'tl-off'}">
        <td style="width:44px"><input type="checkbox" class="tlchk" value="${k}" ${enabled.has(k) ? 'checked' : ''}></td>
        <td style="width:44px;color:#8a9aab">${i + 1}</td>
        <td><b>${labelOf(k)}</b></td>
        <td style="width:150px">
          <button class="btn btn-ghost btn-sm" data-up="${k}" ${i === 0 ? 'disabled' : ''}>上移</button>
          <button class="btn btn-ghost btn-sm" data-down="${k}" ${i === order.length - 1 ? 'disabled' : ''}>下移</button>
        </td>
      </tr>`).join('');
    $$('.tlchk').forEach(c => c.onchange = () => { if (c.checked) enabled.add(c.value); else enabled.delete(c.value); });
    $$('[data-up]').forEach(b => b.onclick = () => {
      const i = order.indexOf(b.dataset.up);
      if (i > 0) { const t = order[i - 1]; order[i - 1] = order[i]; order[i] = t; draw(); }
    });
    $$('[data-down]').forEach(b => b.onclick = () => {
      const i = order.indexOf(b.dataset.down);
      if (i >= 0 && i < order.length - 1) { const t = order[i + 1]; order[i + 1] = order[i]; order[i] = t; draw(); }
    });
  };
  modal('分析树层级自定义', `
    <div class="table-wrap" style="max-height:52vh">
      <table><thead><tr><th style="width:44px">启用</th><th style="width:44px">序号</th><th>层级（字段）</th><th style="width:150px">排序</th></tr></thead>
      <tbody id="tlList"></tbody></table>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" id="tlDefault">恢复默认（产品线 › 产品型号 › 领域 › 测试类型 › 功能模块 › 功能点 › 测试点）</button>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="tlSave">确定</button>
    </div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(760px, 94vw)';
  draw();
  $('#tlDefault').onclick = () => { order = PROD_TREE_DEFAULT.slice(); enabled.clear(); PROD_TREE_DEFAULT.forEach(k => enabled.add(k)); draw(); };
  $('#tlSave').onclick = () => {
    const keys = order.filter(k => enabled.has(k));
    if (!keys.length) { toast('请至少启用一个层级'); return; }
    state.prodTreeLevels = keys;
    /* 清掉已不再展示的层级上的筛选条件 */
    Object.keys(state.prodTreePath).forEach(k => { if (keys.indexOf(k) < 0) delete state.prodTreePath[k]; });
    closeTopModal(); renderProd();
    toast(`分析树层级已更新（${keys.length} 级：${keys.map(labelOf).join(' › ')}）`, 'success');
  };
};


/* ---------- 模块用例库：点击功能模块后按树展开：产品通用 / 指定产品 → 测试类型 → 功能点 → 测试点 ---------- */
const MODULE_TREE_LEVELS = ['branch', 'testType', 'functionPoint', 'testPoint'];
const MODULE_TREE_LABEL = { branch: '分支', testType: '测试类型', functionPoint: '功能点', testPoint: '测试点' };
function moduleTreeKey(path) { return path.map(x => x.level + ':' + encodeURIComponent(x.value)).join('|'); }
function moduleTreeDecode(key) {
  return String(key || '').split('|').filter(Boolean).map(s => {
    const i = s.indexOf(':');
    return { level: s.slice(0, i), value: decodeURIComponent(s.slice(i + 1)) };
  });
}
function moduleTreeValues(row, level) {
  const v = row[level];
  return [v == null || v === '' ? '—' : String(v)];
}
function moduleTreeMatch(row, level, value) { return moduleTreeValues(row, level).indexOf(String(value)) >= 0; }
/* 树基准数据：该模块下经工具条「适用产品型号」等多选条件筛选后的用例（树上数字与该筛选口径一致） */
function moduleTreeBaseRows(module) {
  return DB.stdCases.filter(c => c.module === module && moduleAppliesModel(c, state.stdModel));
}
function buildModuleTree(module) {
  const rows = moduleTreeBaseRows(module);
  const root = { children: new Map(), count: rows.length, path: [] };
  const add = (node, row, idx) => {
    if (idx >= MODULE_TREE_LEVELS.length) return;
    const lv = MODULE_TREE_LEVELS[idx];
    moduleTreeValues(row, lv).forEach(v => {
      let child = node.children.get(v);
      if (!child) {
        child = { value: v, children: new Map(), count: 0, path: node.path.concat([{ level: lv, value: v }]) };
        node.children.set(v, child);
      }
      child.count++;
      add(child, row, idx + 1);
    });
  };
  rows.forEach(r => add(root, r, 0));
  return root;
}
function moduleTreeFiltered(rows) {
  const active = Object.keys(state.stdTreePath).filter(k => MODULE_TREE_LEVELS.indexOf(k) >= 0);
  if (!active.length) return rows;
  return rows.filter(r => active.every(k => moduleTreeMatch(r, k, state.stdTreePath[k])));
}
function moduleTreeNodeActive(path) { return path.every(x => String(state.stdTreePath[x.level]) === String(x.value)); }
function moduleTreeHtml(module) {
  const tree = buildModuleTree(module);
  const out = [];
  const walk = (node, depth) => {
    Array.from(node.children.values()).forEach(child => {
      const key = moduleTreeKey(child.path);
      const hasKids = child.children.size > 0;
      const collapsed = !!state.stdTreeCollapsed[key];
      const active = moduleTreeNodeActive(child.path);
      out.push(`<div class="tree-node${active ? ' active' : ''}" data-mtnode="${key}" style="padding-left:${6 + depth * 12}px">
        <span class="tn-toggle" data-mttoggle="${key}">${hasKids ? (collapsed ? '▸' : '▾') : '·'}</span>
        <span class="tn-label" data-mtpick="${key}">${child.value}</span><em>${child.count}</em></div>`);
      if (hasKids && !collapsed) walk(child, depth + 1);
    });
  };
  walk(tree, 0);
  const keys = Object.keys(state.stdTreePath).filter(k => MODULE_TREE_LEVELS.indexOf(k) >= 0);
  const crumb = keys.length
    ? keys.sort((a, b) => MODULE_TREE_LEVELS.indexOf(a) - MODULE_TREE_LEVELS.indexOf(b)).map(k => `${MODULE_TREE_LABEL[k]}：${state.stdTreePath[k]}`).join('　›　')
    : '全部';
  const shown = moduleTreeFiltered(moduleTreeBaseRows(module)).length;
  return `
    <div class="module-tree">
      <div class="prod-tree-crumb">${module}：<b>${crumb}</b>　<span class="chip">${shown} / ${tree.count} 条</span>
        ${keys.length ? '<span class="link" onclick="clearModuleTree()">清除</span>' : ''}</div>
      <div class="tree-list">${out.join('') || '<div class="empty" style="padding:10px">该模块下暂无用例</div>'}</div>
    </div>`;
}
function bindModuleTree() {
  $$('[data-mttoggle]').forEach(el => el.onclick = (ev) => {
    ev.stopPropagation();
    const key = el.dataset.mttoggle;
    if (state.stdTreeCollapsed[key]) delete state.stdTreeCollapsed[key];
    else state.stdTreeCollapsed[key] = true;
    refreshStdBody();
  });
  $$('[data-mtpick]').forEach(el => el.onclick = () => {
    const path = moduleTreeDecode(el.dataset.mtpick);
    const last = path[path.length - 1];
    if (moduleTreeNodeActive(path) && String(state.stdTreePath[last.level]) === String(last.value)) {
      /* 再次点击同一节点：回到父级路径 */
      state.stdTreePath = {};
      path.slice(0, -1).forEach(x => { state.stdTreePath[x.level] = x.value; });
    } else {
      state.stdTreePath = {};
      path.forEach(x => { state.stdTreePath[x.level] = x.value; });
    }
    state.stdPage = 1;
    refreshStdBody();
  });
}
window.clearModuleTree = function () { state.stdTreePath = {}; refreshStdBody(); };

function renderProd() {
  resetStdCaseIndex();
  /* 记住当前产品：在产品用例库内切换型号后刷新仍停留在同一产品 */
  saveView();
  if (!DB.products.length) {
    $('#page').innerHTML = `<div class="panel" style="border-top:1px solid var(--border)">
      <div class="empty">
        <p>还没有产品，先在「产品用例库」新建一个产品，再从模块用例库中筛选需要使用的用例。</p>
        ${can('manage') ? '<button class="btn btn-primary" onclick="newProduct()">新建产品</button>' : ''}
      </div></div>`;
    return;
  }
  state.prodIndex = Math.min(state.prodIndex, DB.products.length - 1);
  const p = DB.products[state.prodIndex];
  const allRows = prodCaseRows(p);
  const rows = prodTreeFiltered(allRows);
  const filtering = Object.keys(state.prodTreePath).length > 0;
  const refCount = allRows.filter(r => r.source === '引用模块库').length;
  const prodRefCount = allRows.filter(r => r.source === '引用产品用例').length;
  const addedCount = allRows.filter(r => r.source === '产品专属增补').length;
  const members = DB.productMembers[p.model] || [];

  $('#page').innerHTML = `
    <div class="toolbar">
      <div style="position:relative"><label>产品</label>
        <div class="ssel" id="prodSelBox">
          <div class="ssel-display"><span id="prodSelText">${p.model}</span><span class="ssel-caret">▴</span></div>
          <div class="ssel-panel" id="prodSelPanel" style="display:none">
            <div class="ssel-search"><span class="ssel-ico">🔍</span><input id="prodSelKw" placeholder="输入关键字搜索产品型号 / 系列 / 负责人"></div>
            <div class="ssel-list" id="prodSelList"></div>
          </div>
        </div>
      </div>
      <span style="color:#666">系列 ${p.series || '—'}　领域 ${p.domain || '—'}　测试主负责人 ${p.owner || '—'}　产品用例版本 ${p.planVersion}（${p.planDate}）</span>
      <span class="chip">${p.reviewStatus}</span>
      <div class="actions" style="margin-left:auto">
        ${can('manage') ? '<button class="btn btn-primary" onclick="newProduct()">＋ 新建产品</button>' : ''}
        <button class="btn btn-ghost" onclick="editProduct()">产品信息设置</button>
        <button class="btn btn-danger" onclick="delProduct()">删除产品</button>
      </div>
    </div>
    ${exportTodoBannerHtml()}
    <div class="flex">
      <aside class="sidebar prod-tree">
        ${prodTreePanel(allRows, rows)}
      </aside>
      <div class="main">
        <div class="panel">
          <div class="panel-header header-nowrap">
            <h2 class="panel-title">产品用例构成</h2>
            <div class="actions actions-right">
              <button class="btn btn-ghost" id="composeToggle">${state.prodComposeOpen ? '收起分支图' : '展开分支图'}</button>
              <button class="btn btn-primary" onclick="pickStdCases()">从模块用例库筛选用例</button>
              <button class="btn btn-primary" onclick="openPickProdCases()">从产品用例库筛选用例</button>
              <button class="btn btn-ghost" onclick="newProdCase()">新增专属用例</button>
              ${can('edit') ? '<button class="btn btn-ghost" onclick="importProdExcel()">导入 Excel</button>' : ''}
              ${can('export') ? '<button class="btn btn-ghost" onclick="exportProd()">导出 Excel（需审批）</button>' : ''}
              <button class="btn btn-ghost" onclick="downloadProdTemplate()">导入模板</button>
            </div>
          </div>
          <div class="chip-row">
            <span class="chip chip-info">引用模块库 ${refCount} 条</span>
            <span class="chip chip-primary">引用产品用例 ${prodRefCount} 条</span>
            <span class="chip chip-warn">专属增补 ${addedCount} 条</span>
          </div>
          ${state.prodComposeOpen
      ? prodComposeHtml(p)
      : `<div class="hint" style="margin:0">项目成员：${members.join('、') || '未设置'}</div>`}
        </div>
        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">产品用例清单</h2>
            <div class="actions">
              ${filtering ? `<span class="chip chip-primary">分析树已筛选 ${rows.length} / ${allRows.length} 条</span>
                <button class="btn btn-ghost" onclick="clearProdTree()">清除筛选</button>` : ''}
              <button class="btn btn-ghost" onclick="pickStdCases()">调整引用用例</button>
              <button class="btn btn-ghost" onclick="openColPicker('prod')">筛选列</button>
              ${can('reviewCreate') ? '<button class="btn btn-primary" onclick="newProductReview(&#39;${p.model}&#39;)">发起产品用例审核</button>' : ''}
            </div>
          </div>
          
          <div class="table-wrap">
            ${tableByCols('prod', rows)}
          </div>
        </div>
      </div>
    </div>`;
  /* 产品选择：关键字搜索下拉（输入关键字实时过滤，点击选项切换产品） */
  const pBox = $('#prodSelBox'), pPanel = $('#prodSelPanel'), pList = $('#prodSelList'), pKw = $('#prodSelKw');
  const renderProdOptions = () => {
    const kw = (pKw.value || '').trim().toLowerCase();
    const list = DB.products.map((x, i) => ({ x, i })).filter(o => {
      const x = o.x;
      return !kw || String(x.model).toLowerCase().indexOf(kw) >= 0
        || String(x.series || '').toLowerCase().indexOf(kw) >= 0
        || String(x.owner || '').toLowerCase().indexOf(kw) >= 0
        || String(x.domain || '').toLowerCase().indexOf(kw) >= 0;
    });
    pList.innerHTML = list.length ? list.map(({ x, i }) => `
      <div class="ssel-opt${i === state.prodIndex ? ' active' : ''}" data-i="${i}" title="${x.model}｜系列 ${x.series || '—'}｜${x.domain || '—'}｜负责人 ${x.owner || '—'}">
        <span class="ssel-check">${i === state.prodIndex ? '✓' : ''}</span>
        <span class="ssel-opt-main"><b>${x.model}</b><em>${x.series || '—'} · ${x.domain || '—'}</em></span>
        <span class="ssel-opt-tag">${(x.refs || []).length} 引用 · ${(x.added || []).length} 增补</span>
      </div>`).join('') : '<div class="empty" style="padding:12px">没有匹配的产品型号</div>';
    $$('#prodSelList .ssel-opt').forEach(el => el.onclick = () => {
      state.prodIndex = +el.dataset.i;
      state.prodTreePath = {};
      state.prodComposeCollapsed = {};
      state.prodTreeKw = '';
      prodSelClose();
      renderProd();
    });
  };
  const prodSelClose = () => { pPanel.style.display = 'none'; };
  const prodSelOpen = () => {
    pPanel.style.display = '';
    pKw.value = '';
    renderProdOptions();
    pKw.focus();
  };
  pBox.onclick = ev => {
    ev.stopPropagation();
    pPanel.style.display === 'none' ? prodSelOpen() : prodSelClose();
  };
  pPanel.onclick = ev => ev.stopPropagation();
  pKw.oninput = renderProdOptions;
  pKw.onkeydown = ev => {
    if (ev.key === 'Escape') { prodSelClose(); }
    if (ev.key === 'Enter') { const first = $('#prodSelList .ssel-opt'); if (first) first.click(); }
  };
  /* 点击页面其他位置自动收起（全局只注册一次） */
  if (!window.__prodSelOutsideBound) {
    window.__prodSelOutsideBound = true;
    document.addEventListener('click', () => {
      const panel = $('#prodSelPanel');
      if (panel) panel.style.display = 'none';
    });
  }
  const composeBtn = $('#composeToggle');
  if (composeBtn) composeBtn.onclick = () => toggleProdCompose();
  /* 三角：带用例编号的节点控制编号列表展开，其余节点控制分支展开 */
  $$('[data-ctoggle]').forEach(el => el.onclick = ev => {
    ev.stopPropagation();
    if (el.dataset.cids === '1') toggleComposeIds(el.dataset.ctoggle);
    else toggleComposeNode(el.dataset.ctoggle);
  });
  const tk = $('#prodTreeKw');
  if (tk) tk.oninput = e => {
    state.prodTreeKw = e.target.value;
    renderProd();
    setTimeout(() => { const el = $('#prodTreeKw'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0);
  };
  bindProdTree();
}

window.delProduct = function () {
  if (!guard('delete', '删除')) return;
  const p = DB.products[state.prodIndex];
  const refs = (p.refs || []).reduce((n, r) => n + (r.caseIds || []).length, 0);
  const usedByTask = DB.tasks.filter(t => (t.caseSource || '').includes(p.model) && t.finished !== '是').length;
  confirmModal('删除产品', `<p>确定删除产品 <b>${p.model}</b>？</p>
    ${refs || usedByTask ? `<p style="color:#ef4444">该产品引用了 ${refs} 条模块用例${usedByTask ? `，且被 ${usedByTask} 个未完结任务引用` : ''}，删除后这些关联会一并清除。</p>` : ''}`, () => {
    log('删除产品', `${p.model}（引用 ${refs} 条，专属增补 ${(p.added || []).length} 条）`);
    DB.products.splice(state.prodIndex, 1);
    delete DB.productMembers[p.model];
    state.prodIndex = Math.max(0, state.prodIndex - 1);
    closeTopModal(); renderProd(); toast('产品已删除', 'success');
  });
};

window.editProdCase = function (id) {
  if (!guard('modify', '修改用例')) return;
  const p = DB.products[state.prodIndex];
  const a = p.added.find(x => x.id === id);
  if (!a) return;
  formModal(`编辑专属用例 · ${id}`, [
    {
      key: 'module', label: '功能模块（支持自定义填写）', type: 'text', list: DB.stdModules.map(m => m.name),
      value: a.module, placeholder: '选择或直接输入新模块名称'
    },
    {
      key: 'caseDomain', label: '用例领域（手工填写）', type: 'select', options: DOMAIN_OPTIONS,
      value: normDomain(a.domain, normDomain((DB.stdModules.find(m => m.name === a.module) || {}).domain, '固件'))
    },
    { key: 'testType', label: '测试类型', type: 'select', options: ['功能测试', '易用性测试', '兼容性测试', '性能测试', '可靠性测试', '安全测试'], value: a.testType || '功能测试' },
    { key: 'level', label: '用例等级', type: 'select', options: ['L1', 'L2', 'L3'], value: a.level },
    { key: 'summary', label: '用例概述', type: 'text', value: a.summary },
    { key: 'functionPoint', label: '功能点', type: 'text', value: a.functionPoint || '' },
    { key: 'testPoint', label: '测试点', type: 'text', value: a.testPoint || '' },
    { key: 'pre', label: '前置条件', type: 'textarea', value: a.pre || '' },
    { key: 'steps', label: '操作步骤', type: 'textarea', value: a.steps || '' },
    { key: 'input', label: '输入数据', type: 'text', value: a.input || '无' },
    { key: 'expect', label: '预期结果', type: 'textarea', value: a.expect || '' },
    { key: 'remark', label: '备注', type: 'text', value: a.remark || '无' },
    { key: 'testProject', label: '测试项目', type: 'text', value: a.testProject || '', placeholder: '不填默认取功能模块名称' },
    { key: 'minutes', label: '手动测试时间（min）', type: 'number', value: a.minutes == null ? '' : a.minutes },
    { key: 'autoFlag', label: '自动化标志', type: 'select', options: ['否', '是'], value: a.autoFlag || '否' },
    { key: 'autoTool', label: '自动化工具', type: 'text', value: a.autoTool === '—' ? '' : (a.autoTool || ''), placeholder: '自动化标志为「是」时填写' },
    { key: 'autoTime', label: '自动化测试时间（min）', type: 'number', value: (a.autoTime && a.autoTime !== '—') ? a.autoTime : '' },
    { key: 'caseSource', label: '用例来源', type: 'select', options: SOURCE_OPTIONS, value: a.caseSource || '需求' },
    {
      key: 'marketBug', label: '市场反馈 BUG', type: 'text', value: a.marketBug || '', placeholder: '市场问题单号 / BUG 编号',
      dependsOn: { key: 'caseSource', equals: MARKET_SOURCE }, required: { key: 'caseSource', equals: MARKET_SOURCE }
    },
    {
      key: 'marketBugDate', label: '市场反馈时间', type: 'text', value: a.marketBugDate || '', placeholder: 'YYYY-MM-DD',
      dependsOn: { key: 'caseSource', equals: MARKET_SOURCE }, required: { key: 'caseSource', equals: MARKET_SOURCE }
    }
  ], v => {
    const module = v.module.trim();
    if (!module) { toast('请填写功能模块'); return false; }
    if (!v.summary.trim()) { toast('请填写用例概述'); return false; }
    ensureModuleExists(module, v.caseDomain, '编辑产品专属增补用例');
    const autoOn = v.autoFlag === '是';
    const marketOn = v.caseSource === MARKET_SOURCE;
    Object.assign(a, {
      module, domain: normDomain(v.caseDomain, a.domain), testType: v.testType, level: v.level, summary: v.summary,
      caseSource: v.caseSource,
      functionPoint: v.functionPoint || module, testPoint: v.testPoint || '功能逻辑',
      pre: v.pre, steps: v.steps, input: v.input, expect: v.expect, remark: v.remark,
      testProject: v.testProject.trim() || module, minutes: v.minutes || '',
      autoFlag: v.autoFlag, autoTool: autoOn ? (v.autoTool.trim() || '—') : '—',
      autoTime: autoOn && v.autoTime !== '' ? v.autoTime : '—', autoUpdatedAt: autoOn ? today() : '—',
      marketBug: marketOn ? v.marketBug.trim() : '', marketBugDate: marketOn ? v.marketBugDate.trim() : ''
    });
    log('编辑产品专属用例', `${p.model}｜${id}｜${v.summary}`);
    closeTopModal(); renderProd(); toast('已保存修改', 'success');
  });
};

/* 编辑引用来的模块用例：保存即解除引用关系，转为该产品的专属增补用例 */
window.editRefCase = function (stdCaseId) {
  const p = DB.products[state.prodIndex];
  const c = DB.stdCases.find(x => x.id === stdCaseId);
  if (!c) { toast('源模块用例已不存在'); return; }
  formModal(`编辑引用用例 · ${c.id}`, [
    {
      key: 'module', label: '功能模块（支持自定义填写）', type: 'text', list: DB.stdModules.map(m => m.name),
      value: c.module, placeholder: '选择或直接输入新模块名称'
    },
    {
      key: 'caseDomain', label: '用例领域（手工填写）', type: 'select', options: DOMAIN_OPTIONS,
      value: normDomain(c.domain, normDomain((DB.stdModules.find(m => m.name === c.module) || {}).domain, '固件'))
    },
    { key: 'level', label: '用例等级', type: 'select', options: ['L1', 'L2', 'L3'], value: c.level },
    { key: 'summary', label: '用例概述', type: 'text', value: c.summary },
    { key: 'pre', label: '前置条件', type: 'textarea', value: c.pre || '' },
    { key: 'steps', label: '操作步骤', type: 'textarea', value: c.steps || '' },
    { key: 'input', label: '输入数据', type: 'text', value: c.input || '无' },
    { key: 'expect', label: '预期结果', type: 'textarea', value: c.expect || '' },
    { key: 'remark', label: '备注', type: 'text', value: c.remark || '无' },
    { key: 'caseSource', label: '用例来源', type: 'select', options: SOURCE_OPTIONS, value: c.source || '需求' },
    {
      key: 'marketBug', label: '市场反馈 BUG', type: 'text', value: c.marketBug || '', placeholder: '市场问题单号 / BUG 编号',
      dependsOn: { key: 'caseSource', equals: MARKET_SOURCE }, required: { key: 'caseSource', equals: MARKET_SOURCE }
    },
    {
      key: 'marketBugDate', label: '市场反馈时间', type: 'text', value: c.marketBugDate || '', placeholder: 'YYYY-MM-DD',
      dependsOn: { key: 'caseSource', equals: MARKET_SOURCE }, required: { key: 'caseSource', equals: MARKET_SOURCE }
    }
  ], v => {
    const module = v.module.trim() || c.module;
    if (!v.summary.trim()) { toast('请填写用例概述'); return false; }
    ensureModuleExists(module, v.caseDomain, '引用用例转产品专属增补');
    const marketOn = v.caseSource === MARKET_SOURCE;
    /* 1. 解除该模块用例在本产品下的引用关系 */
    let removed = 0;
    (p.refs || []).forEach(r => {
      const before = (r.caseIds || []).length;
      r.caseIds = (r.caseIds || []).filter(id => id !== stdCaseId);
      removed += before - r.caseIds.length;
    });
    p.refs = (p.refs || []).filter(r => (r.caseIds || []).length);
    /* 2. 以产品专属增补写入本产品用例库，并保留来源追溯（编号前段为产品名称） */
    const seq = p.added.filter(a => String(a.id).indexOf(`${p.model}-A`) === 0).length + 1;
    const newId = prodCaseNo(p.model, 'A' + String(seq).padStart(2, '0'));
    p.added.push({
      id: newId, module, domain: normDomain(v.caseDomain, c.domain), summary: v.summary, level: v.level,
      caseSource: v.caseSource, date: today(),
      reviewer: DB.currentUser, feedback: '待回流确认',
      pre: v.pre, steps: v.steps, input: v.input, expect: v.expect, remark: v.remark,
      testType: c.testType || '功能测试', functionPoint: c.functionPoint || module, testPoint: c.testPoint || '功能逻辑',
      /* 内容字段继承源用例，保证转增补后与模块库字段一致（不丢信息） */
      testProject: c.testProject || module, minutes: c.minutes || '',
      autoFlag: c.autoFlag || '否', autoTool: c.autoTool || '—', autoTime: c.autoTime || '—',
      autoUpdatedAt: c.autoUpdatedAt || '—', bugCount: 0, bugIds: [], bugId: '—',
      marketBug: marketOn ? (v.marketBug || '').trim() : '', marketBugDate: marketOn ? (v.marketBugDate || '').trim() : '',
      fromRef: c.id, fromRefModule: c.module, fromRefBranch: c.branch
    });
    p.planDate = today();
    if (p.reviewStatus.indexOf('审核通过') < 0) p.reviewStatus = '待发起产品用例审核';
    log('引用用例转为产品专属增补', `${p.model}｜${c.id}（${c.module} · ${c.branch}）→ ${newId}｜已解除模块库引用${removed > 1 ? `（${removed} 处引用）` : ''}，该用例不再随模块用例库更新`);
    closeTopModal(); renderProd();
    toast(`已转为产品专属增补：${newId}，不再引用模块用例库`, 'success');
  }, '保存后该用例将解除与模块用例库的引用关系，转为产品专属增补用例。');
};

window.newProduct = function () {
  if (!guard('edit')) return;
  const fields = [
    { key: 'model', label: '产品型号（唯一）', type: 'text' },
    { key: 'series', label: '产品系列', type: 'text' },
    { key: 'owner', label: '产品测试主负责人', type: 'text', value: DB.currentUser },
    { key: 'members', label: '项目成员（产品用例审核参会范围）', type: 'multi', options: DB.deptMembers, value: [DB.currentUser] }
  ];
  formModal('新建产品', fields, v => {
    const model = v.model.trim();
    if (!model) { toast('请填写产品型号'); return false; }
    if (DB.products.some(p => p.model === model)) { toast('该产品型号已存在'); return false; }
    DB.products.push({
      model, series: v.series.trim(), domain: '', owner: v.owner.trim() || DB.currentUser,
      planVersion: 'V1.0', planDate: today(),
      reviewStatus: '待组合模块用例', refs: [], added: []
    });
    DB.productMembers[model] = v.members.length ? v.members : [DB.currentUser];
    log('新建产品', `${model}｜${v.series || '—'}｜负责人 ${v.owner}`);
    state.prodIndex = DB.products.length - 1;
    closeTopModal(); renderProd(); toast('产品已创建，接着从模块用例库筛选用例');
    setTimeout(() => pickStdCases(), 200);
  });
};

window.editProduct = function () {
  if (!guard('modify', '修改用例 / 产品信息')) return;
  const p = DB.products[state.prodIndex];
  const old = p.model;
  formModal(`产品信息设置 · ${old}`, [
    { key: 'model', label: '产品型号', type: 'text', value: p.model },
    { key: 'series', label: '产品系列', type: 'text', value: p.series || '' },
    { key: 'domain', label: '领域', type: 'select', options: ['固件', '硬件', '软件'], value: p.domain },
    { key: 'owner', label: '产品测试主负责人', type: 'text', value: p.owner || '' },
    { key: 'planVersion', label: '产品用例版本', type: 'text', value: p.planVersion },
    { key: 'members', label: '项目成员（产品用例审核参会范围）', type: 'multi', options: DB.deptMembers, value: DB.productMembers[old] || [] }
  ], v => {
    const model = v.model.trim();
    if (!model) { toast('请填写产品型号'); return false; }
    if (model !== old && DB.products.some(x => x.model === model)) { toast('该产品型号已存在'); return false; }
    /* 编辑前快照：产品信息设置的全部字段都做「原值 → 现值」留痕 */
    const before = {
      model: p.model, series: p.series || '', domain: p.domain || '', owner: p.owner || '',
      planVersion: p.planVersion || '', members: (DB.productMembers[old] || []).slice()
    };
    p.model = model; p.series = v.series.trim(); p.domain = v.domain; p.owner = v.owner.trim(); p.planVersion = v.planVersion.trim();
    DB.productMembers[model] = v.members.length ? v.members : [DB.currentUser];
    if (model !== old) delete DB.productMembers[old];
    const changes = diffFields(before, Object.assign({}, p, { members: DB.productMembers[model] }), PRODUCT_LOG_FIELDS);
    log('产品信息设置', `${old}${model !== old ? ` → ${model}` : ''}｜${changesText(changes) || '无字段变化'}`,
      '', { module: '产品用例库', objType: '产品', objId: model, changes });
    closeTopModal(); renderProd(); toast('产品信息已更新');
  });
};

/* 从模块用例库筛选需要使用的用例 */
/* 可引用判定：仅审核通过（状态「正常」）的模块用例允许被引用 */
function stdCaseRefable(c) { return !!c && (c.status || '正常') === '正常'; }
window.pickStdCases = function () {
  const p = DB.products[state.prodIndex];
  const picked = new Set();
  let blockedRefs = 0;
  (p.refs || []).forEach(r => (r.caseIds || []).forEach(id => {
    const c = DB.stdCases.find(x => x.id === id);
    if (!c) { picked.add(id); return; }
    if (stdCaseRefable(c)) picked.add(id); else blockedRefs++;
  }));
  const branches = Array.from(new Set(DB.stdCases.map(c => c.branch)));

  modal(`从模块用例库筛选用例 · ${p.model}`, `
    
    <div class="form" style="grid-template-columns:repeat(4,1fr)">
      <div class="field"><label>用例领域</label><select id="pf_domain" multiple data-ssel-empty="全部领域" title="可多选：命中任一领域的用例都会列出">${domainOptions(DB.stdCases.map(c => stdDomainOf(c))).filter(Boolean).map(d => `<option value="${d}">${d}</option>`).join('')}</select></div>
      <div class="field"><label>功能模块</label><select id="pf_module" multiple data-ssel-empty="全部模块" title="可多选：命中任一模块的用例都会列出">${DB.stdModules.map(m => `<option value="${m.name}">${m.name}</option>`).join('')}</select></div>
      <div class="field"><label>分支类型</label><select id="pf_branch" multiple data-ssel-empty="全部分支" title="可多选：命中任一分支的用例都会列出">${branches.map(b => `<option value="${b}">${b}</option>`).join('')}</select></div>
      <div class="field"><label>用例等级</label><select id="pf_level" multiple data-ssel-empty="全部等级" title="可多选：命中任一等级的用例都会列出"><option value="L1">L1</option><option value="L2">L2</option><option value="L3">L3</option></select></div>
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr 1.3fr 1.7fr">
      <div class="field"><label>测试类型</label><select id="pf_testType" multiple data-ssel-empty="全部类型" title="可多选：命中任一类型的用例都会列出">${Array.from(new Set(DB.stdCases.map(c => c.testType || '功能测试'))).sort().map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
      <div class="field"><label>用例状态</label><select id="pf_state" multiple data-ssel-empty="全部状态" title="可多选：命中任一状态的用例都会列出">${['正常', '新增', '回退', '停用'].map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>
      <div class="field" title="可多选：含「产品通用」不限型号用例 + 「指定产品」中声明了所选任一型号的用例"><label>适用产品型号</label><select id="pf_model" multiple data-ssel-empty="全部型号">${stdModelOptions().map(m => `<option value="${m}">${m}</option>`).join('')}</select></div>
      <div class="field"><label>关键字（编号 / 功能点 / 概述）</label><input id="pf_kw"></div>
    </div>
    <div class="pickbar">
      <span>已选 <b id="pickCount">0</b> 条<span class="hint" style="margin:0 0 0 10px" id="pickHitTip"></span>
        <label style="margin-left:14px;color:#6b7c8f;font-size:13px;cursor:pointer"><input type="checkbox" id="pf_onlyRef" ${state.pickOnlyRefable ? 'checked' : ''}> 仅显示可引用用例</label>
        <label style="margin-left:14px;color:#6b7c8f;font-size:13px;cursor:pointer"><input type="checkbox" id="pf_showOff" ${state.pickShowOff ? 'checked' : ''}> 显示已停用用例</label>
        <span class="hint" style="margin:0 0 0 12px" id="pickRefTip"></span>
        <span class="hint" style="margin:0 0 0 12px" id="pickColTip"></span>
      </span>
      <span>
        <span class="link" id="pickReset">重置筛选</span>
        <span class="link" id="pickCols">筛选列</span>
        <span class="link" id="pickAll">全选筛选结果</span>
        <span class="link" id="pickNone">清空</span>
      </span>
    </div>
    <div class="table-wrap" id="pickList" style="max-height:44vh"></div>
    <div class="form-actions">
      <button class="btn btn-primary" id="pickOk">确认引用所选用例</button>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
    </div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1500px, 94vw)';

  /* 筛选：每个下拉都是多选，命中任一所选项即列出（不选 = 全部）；
     「适用产品型号」与模块用例库筛选区同一口径（moduleAppliesModel：产品通用不限型号 + 指定产品按声明型号） */
  const filtered = () => {
    const doms = selValues($('#pf_domain')), mods = selValues($('#pf_module')), brs = selValues($('#pf_branch')),
      lvs = selValues($('#pf_level')), tts = selValues($('#pf_testType')), stts = selValues($('#pf_state')),
      mdls = selValues($('#pf_model')), kw = $('#pf_kw').value.trim();
    const anyOf = (arr, v) => !arr.length || arr.indexOf(v) >= 0;
    return DB.stdCases.filter(c => {
      if (state.pickOnlyRefable && !stdCaseRefable(c)) return false;
      return (state.pickShowOff || c.status !== '停用') &&
        anyOf(doms, stdDomainOf(c)) && anyOf(mods, c.module) && anyOf(brs, c.branch) && anyOf(lvs, c.level) &&
        anyOf(tts, c.testType || '功能测试') && anyOf(stts, c.status || '正常') &&
        moduleAppliesModel(c, mdls) &&
        (!kw || c.id.includes(kw) || (c.functionPoint || '').includes(kw) || (c.summary || '').includes(kw));
    });
  };
  /* 弹窗内全部筛选控件（供 change 绑定与「重置筛选」共用） */
  const pickFilters = ['pf_domain', 'pf_module', 'pf_branch', 'pf_level', 'pf_testType', 'pf_state', 'pf_model'];
  const draw = () => {
    if (!$('#pickList')) return;
    const list = filtered();
    $('#pickCount').textContent = picked.size;
    $('#pickHitTip').textContent = `筛选命中 ${list.length} 条`;
    $('#pickList').innerHTML = list.length
      ? tableByCols('pick', list, {
        compact: true,
        leadHead: '<th style="width:96px">选择</th>',
        leadCell: c => (stdCaseRefable(c)
          ? `<td><input type="checkbox" class="pickone" data-id="${c.id}" ${picked.has(c.id) ? 'checked' : ''}></td>`
          : '<td><input type="checkbox" disabled title="未审核通过：不可引用"><span class="chip chip-off" title="仅审核通过（状态「正常」）的模块用例可被引用">不可引用</span></td>')
      })
      : `<div class="empty">${state.pickOnlyRefable ? '没有可引用的模块用例（可取消「仅显示可引用用例」查看全部）' : '没有符合筛选条件的模块用例'}</div>`;
    $$('.pickone').forEach(chk => chk.onchange = () => {
      chk.checked ? picked.add(chk.dataset.id) : picked.delete(chk.dataset.id);
      $('#pickCount').textContent = picked.size;
    });
    const refable = DB.stdCases.filter(stdCaseRefable).length;
    $('#pickRefTip').textContent = `可引用 ${refable} / ${DB.stdCases.length} 条${blockedRefs ? `　已存在 ${blockedRefs} 条指向未审核通过用例的引用，保存时将自动移除` : ''}`;
    $('#pickColTip').textContent = `显示 ${selectedCols('pick').length}/${COL_SCHEMAS.pick.fields.length} 列`;
  };
  window.__pickRedraw = draw;
  $('#pickCols').onclick = () => openColPicker('pick');
  /* 多选下拉勾选即时生效（增强层在勾选后派发 change），无需再点按钮 */
  pickFilters.filter(id => id !== 'pf_state').forEach(id => {
    const el = $('#' + id);
    if (el) el.onchange = draw;
  });
  /* 选中「正常」以外的状态时自动放宽过滤（未审核通过 / 停用用例默认被隐藏或禁选），避免筛选结果为空 */
  $('#pf_state').onchange = () => {
    const relaxed = selValues($('#pf_state')).filter(s => s !== '正常');
    if (relaxed.length) {
      if (state.pickOnlyRefable) { state.pickOnlyRefable = false; $('#pf_onlyRef').checked = false; }
      if (relaxed.indexOf('停用') >= 0 && !state.pickShowOff) { state.pickShowOff = true; $('#pf_showOff').checked = true; }
      toast(`已自动放宽过滤条件，便于查看「${relaxed.join('、')}」状态的用例（仍不可引用，仅供查看）`);
    }
    draw();
  };
  /* 重置筛选：清空全部筛选下拉（含多选）与关键字，回到「全部」 */
  $('#pickReset').onclick = () => {
    pickFilters.forEach(id => { const el = $('#' + id); if (el) el.value = []; });
    $('#pf_kw').value = '';
    draw();
    toast('已重置筛选条件');
  };
  $('#pf_kw').oninput = draw;
  $('#pf_onlyRef').onchange = e => { state.pickOnlyRefable = e.target.checked; draw(); };
  $('#pf_showOff').onchange = e => { state.pickShowOff = e.target.checked; draw(); };
  $('#pickAll').onclick = () => { filtered().filter(stdCaseRefable).forEach(c => picked.add(c.id)); draw(); };
  $('#pickNone').onclick = () => { picked.clear(); draw(); };
  $('#pickOk').onclick = () => {
    /* 双重校验：未审核通过的用例一律不允许引用（含历史遗留的违规引用，保存时自动剔除） */
    const blocked = Array.from(picked).filter(id => { const c = DB.stdCases.find(x => x.id === id); return c && !stdCaseRefable(c); });
    blocked.forEach(id => picked.delete(id));
    if (!picked.size) { toast(blocked.length ? `所选用例未审核通过，不可引用（${blocked.length} 条）` : '至少选择一条模块用例'); return; }
    const byBranch = {};
    picked.forEach(id => {
      const c = DB.stdCases.find(x => x.id === id);
      if (!c) return;
      const key = c.module + '||' + c.branch;
      if (!byBranch[key]) byBranch[key] = { module: c.module, branch: c.branch, date: today(), caseIds: [] };
      byBranch[key].caseIds.push(id);
    });
    const oldRefs = p.refs || [];
    p.refs = Object.keys(byBranch).map(k => Object.assign({}, byBranch[k]));
    p.planDate = today();
    if (p.reviewStatus.indexOf('审核通过') < 0) p.reviewStatus = '待发起产品用例审核';
    const lost = oldRefs.reduce((n, r) => n + (r.caseIds || []).filter(id => DB.stdCases.some(c => c.id === id) && !picked.has(id)).length, 0);
    /* 历史遗留的「未审核通过」引用同样不保留 */
    const removedByReview = oldRefs.reduce((n, r) => n + (r.caseIds || []).filter(id => { const c = DB.stdCases.find(x => x.id === id); return c && !stdCaseRefable(c); }).length, 0);
    log('引用模块用例', `${p.model}｜引用 ${picked.size} 条，覆盖 ${p.refs.length} 个「功能模块 · 分支」${lost ? `｜取消引用 ${lost} 条` : ''}${removedByReview ? `｜移除未审核通过的引用 ${removedByReview} 条` : ''}`);
    save();
    closeTopModal(); renderProd();
    toast(`已引用 ${picked.size} 条模块用例${blocked.length + removedByReview ? `（${blocked.length + removedByReview} 条未审核通过，不可引用已跳过 / 移除）` : ''}`, 'success');
  };
  draw();
};

window.removeRef = function (ri) {
  const p = DB.products[state.prodIndex];
  const r = p.refs[ri];
  confirmModal('取消引用', `<p>确定取消对 <b>${r.module} · ${r.branch}</b> 的引用？该分支下已引用的 ${(r.caseIds || []).length} 条用例将从本产品移除。</p>`, () => {
    p.refs.splice(ri, 1);
    log('取消模块用例引用', `${p.model}｜${r.module} · ${r.branch}`);
    closeTopModal(); renderProd(); toast('已取消引用');
  });
};
window.removeRefCase = function (stdCaseId) {
  const p = DB.products[state.prodIndex];
  p.refs.forEach(r => { r.caseIds = (r.caseIds || []).filter(id => id !== stdCaseId); });
  const before = p.refs.length;
  p.refs = p.refs.filter(r => r.caseIds.length);
  log('移除引用用例', `${p.model}｜${stdCaseId}`);
  save(); renderProd(); toast('已移除引用' + (before !== p.refs.length ? '，该分支已无引用' : ''));
};
window.removeAdded = function (id) {
  const p = DB.products[state.prodIndex];
  confirmModal('删除专属用例', `<p>确定删除产品专属用例 <b>${id}</b>？</p>`, () => {
    p.added = p.added.filter(a => a.id !== id);
    log('删除产品专属用例', `${p.model}｜${id}`);
    closeTopModal(); renderProd(); toast('已删除');
  });
};
/* ---------- 产品用例构成分支图（默认隐藏）
   折叠入口统一为节点行首三角：一级节点展开 / 收起分支，二级节点展开 / 收起用例编号列表 ---------- */
function composeNode(key, depth, label, count, extra, list, lv1Keys) {
  const coll = state.prodComposeCollapsed || {};
  const idsOpen = !!(state.prodComposeIdsOpen || {})[`ids:${key}`];
  const collapsed = !!coll[key];
  const ids = list || [];
  const hasIds = ids.length > 0;
  /* 带用例编号的节点（引用组 / 来源产品 / 增补模块）：三角 = 展开收起编号；否则三角 = 展开收起分支 */
  const arrow = hasIds ? (idsOpen ? '▾' : '▸') : (collapsed ? '▸' : '▾');
  const toggleTip = hasIds ? '展开 / 收起用例编号' : '展开 / 收起分支';
  /* 分隔符用 ~~ ，避免与节点键里的 || 冲突 */
  const allTip = (lv1Keys && lv1Keys.length && !collapsed)
    ? `<span class="link" onclick="toggleComposeIdsAll('${lv1Keys.join('~~')}',true)">全部展开编号</span>
       <span class="link" onclick="toggleComposeIdsAll('${lv1Keys.join('~~')}',false)">全部收起编号</span>`
    : '';
  return `<div class="tree-node ${lv1Keys ? 'compose-lv1' : ''}" style="padding-left:${6 + depth * 16}px">
      <span class="tn-toggle" data-ctoggle="${key}" data-cids="${hasIds ? '1' : '0'}" title="${toggleTip}">${arrow}</span>
      <span class="tn-label">${label}</span><em>${count}</em>
      <span class="compose-extra">${extra || ''}${allTip}</span>
    </div>
    ${hasIds && idsOpen
      ? `<div class="compose-ids" style="padding-left:${6 + depth * 16 + 14}px">
          ${ids.slice(0, 12).map(x => `<span class="chip">${x}</span>`).join('')}${ids.length > 12 ? `<span class="hint" style="margin:0">等 ${ids.length} 条</span>` : ''}
         </div>`
      : (hasIds ? `<div class="compose-ids compose-ids-folded" style="padding-left:${6 + depth * 16 + 14}px">
          <span class="hint" style="margin:0">${ids.length} 条用例编号已收起</span></div>` : '')}`;
}
function prodComposeHtml(p) {
  const coll = state.prodComposeCollapsed || {};
  const rows = prodCaseRows(p);
  const refs = rows.filter(r => r.source === '引用模块库');
  const prods = rows.filter(r => r.source === '引用产品用例');
  const adds = rows.filter(r => r.source === '产品专属增补');
  const parts = [];
  const emptyTip = txt => `<div class="compose-ids" style="padding-left:22px"><span class="hint" style="margin:0">${txt}</span></div>`;
  /* ① 引用模块用例库：按「功能模块 · 分支」展开 */
  const stdKeys = (p.refs || []).map(r => `std:${r.module}||${r.branch}`);
  parts.push(composeNode('src:std', 0, '引用模块用例库', refs.length, '', null, stdKeys));
  if (!coll['src:std']) {
    (p.refs || []).forEach((r, ri) => {
      const key = `std:${r.module}||${r.branch}`;
      const list = refs.filter(x => x.module === r.module && x.branch === r.branch).map(x => x.id);
      parts.push(composeNode(key, 1, `${r.module} · ${r.branch}`, list.length,
        `引用日期 ${r.date || '—'}
         <span class="link" onclick="gotoStdModule('${r.module}')">查看模块用例</span>
         <span class="link" onclick="removeRef(${ri})">取消该分支引用</span>`, list));
    });
    if (!(p.refs || []).length) parts.push(emptyTip('尚未引用模块用例，点击「从模块用例库筛选用例」开始组合'));
  }
  /* ② 引用产品用例库：按来源产品展开 */
  const prodKeys = (p.prodRefs || []).map(pr => `prod:${pr.fromModel}`);
  parts.push(composeNode('src:prod', 0, '引用产品用例库', prods.length, '', null, prodKeys));
  if (!coll['src:prod']) {
    (p.prodRefs || []).forEach(pr => {
      const key = `prod:${pr.fromModel}`;
      const list = prods.filter(x => x.fromProduct === pr.fromModel).map(x => x.id);
      parts.push(composeNode(key, 1, `来自产品库 ${pr.fromModel}`, list.length,
        `<span class="link" onclick="gotoProd('${pr.fromModel}')">查看该产品</span>`, list));
    });
    if (!(p.prodRefs || []).length) parts.push(emptyTip('未引用其他产品的产品用例，点击「从产品用例库筛选用例」可引用（编号保持不变）'));
  }
  /* ③ 产品专属增补：按功能模块展开 */
  const addMods = Array.from(new Set((p.added || []).map(a => a.module)));
  parts.push(composeNode('src:added', 0, '产品专属增补', adds.length, '', null, addMods.map(m => `add:${m}`)));
  if (!coll['src:added']) {
    addMods.forEach(m => {
      const key = `add:${m}`;
      const items = (p.added || []).filter(a => a.module === m);
      parts.push(composeNode(key, 1, `${m}`, items.length,
        items.slice(0, 3).map(a => `<span class="link" onclick="applyReflow('${a.id}')">申请回流</span>`).join(''),
        items.map(a => a.id)));
    });
    if (!(p.added || []).length) parts.push(emptyTip('暂无产品专属增补用例，点击「新增专属用例」添加'));
  }
  return `<div class="hint">当前产品共 <b>${rows.length}</b> 条产品用例：引用模块用例库 ${refs.length} 条、引用产品用例库 ${prods.length} 条、产品专属增补 ${adds.length} 条。</div>
    <div class="tree-list compose-tree">${parts.join('')}</div>`;
}
window.toggleProdCompose = function () { state.prodComposeOpen = !state.prodComposeOpen; renderProd(); };
window.toggleComposeNode = function (key) {
  state.prodComposeCollapsed = state.prodComposeCollapsed || {};
  if (state.prodComposeCollapsed[key]) delete state.prodComposeCollapsed[key];
  else state.prodComposeCollapsed[key] = true;
  renderProd();
};
/* 用例编号列表：展开 / 收起（由节点行首三角触发） */
window.toggleComposeIds = function (key) {
  state.prodComposeIdsOpen = state.prodComposeIdsOpen || {};
  const k = `ids:${key}`;
  if (state.prodComposeIdsOpen[k]) delete state.prodComposeIdsOpen[k];
  else state.prodComposeIdsOpen[k] = true;
  renderProd();
};
/* 用例编号列表：整组展开 / 收起 */
window.toggleComposeIdsAll = function (keysCsv, open) {
  state.prodComposeIdsOpen = state.prodComposeIdsOpen || {};
  String(keysCsv || '').split('~~').filter(Boolean).forEach(k => {
    if (open) state.prodComposeIdsOpen[`ids:${k}`] = true;
    else delete state.prodComposeIdsOpen[`ids:${k}`];
  });
  renderProd();
};

/* 从产品用例库筛选用例：引用其他产品的产品用例，编号沿用被引用用例编号（不新增前缀） */
window.openPickProdCases = function () {
  if (!guard('edit')) return;
  const p = DB.products[state.prodIndex];
  const others = DB.products.filter(x => x.model !== p.model);
  if (!others.length) { toast('暂无可引用的其他产品用例库'); return; }
  const already = new Set();
  (p.prodRefs || []).forEach(pr => (pr.caseIds || []).forEach(id => already.add(`${pr.fromModel}||${id}`)));
  /* 已勾选集合：与表格列展示、筛选、重绘无关，保证列设置变化后选择不丢 */
  const picked = new Set();
  modal(`从产品用例库筛选用例 · ${p.model}`, `
    
    <div class="form" style="grid-template-columns:1.2fr 1fr .7fr 1fr 1fr">
      <div class="field"><label>来源产品</label><select id="ppModel">${others.map(x => `<option>${x.model}</option>`).join('')}</select></div>
      <div class="field"><label>功能模块</label><select id="ppModule"><option value="">全部</option></select></div>
      <div class="field"><label>用例等级</label><select id="ppLevel"><option value="">全部</option><option>L1</option><option>L2</option><option>L3</option></select></div>
      <div class="field"><label>测试类型</label><select id="ppType"><option value="">全部</option></select></div>
      <div class="field"><label>来源类型</label><select id="ppSrc"><option value="">全部</option><option>引用模块库</option><option>引用产品用例</option><option>产品专属增补</option></select></div>
    </div>
    <div class="form" style="grid-template-columns:1fr">
      <div class="field"><label>关键字（编号 / 功能模块 / 用例概述）</label><input id="ppKw"></div>
    </div>
    <div class="pickbar">
      <span>已选 <b id="ppCount">0</b> 条　<span class="hint" style="margin:0" id="ppTip"></span></span>
      <span>
        <span class="link" id="ppCols">筛选列</span>
        <span class="link" id="ppAll">全选筛选结果</span>
        <span class="link" id="ppNone">清空已选</span>
      </span>
    </div>
    <div class="table-wrap" style="max-height:44vh" id="ppList"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="ppOk">引用选中用例</button>
    </div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1560px, 96vw)';
  /* 下拉选项按来源产品的实际数据动态生成（保留仍有效的已选值） */
  const syncOptions = (el, values) => {
    const cur = el.value;
    el.innerHTML = '<option value="">全部</option>' + values.map(v => `<option>${v}</option>`).join('');
    el.value = values.indexOf(cur) >= 0 ? cur : '';
  };
  const allOf = () => {
    const src = DB.products.find(x => x.model === $('#ppModel').value);
    return src ? prodCaseRows(src) : [];
  };
  /* 当前筛选命中的用例（「全选筛选结果」与表格渲染共用同一份过滤逻辑） */
  const shownRows = () => {
    const kw = $('#ppKw').value.trim(), mod = $('#ppModule').value, lv = $('#ppLevel').value,
      tt = $('#ppType').value, sc = $('#ppSrc').value;
    return allOf().filter(r =>
      (!mod || r.module === mod) &&
      (!lv || (r.level || '') === lv) &&
      (!tt || (r.testType || '') === tt) &&
      (!sc || r.source === sc) &&
      (!kw || r.id.includes(kw) || (r.module || '').includes(kw) || (r.summary || '').includes(kw)));
  };
  const draw = () => {
    if (!$('#ppList')) return;
    const from = $('#ppModel').value;
    const all = allOf();
    const shown = shownRows();
    const cols = COL_SCHEMAS.pickProd.fields.length;
    $('#ppCount').textContent = picked.size;
    $('#ppTip').textContent = `${from} 共 ${all.length} 条，命中 ${shown.length} 条，已引用 ${already.size} 条，显示 ${selectedCols('pickProd').length}/${cols} 列`;
    $('#ppList').innerHTML = shown.length
      ? tableByCols('pickProd', shown, {
        compact: true,
        leadHead: '<th style="width:56px">选择</th>',
        leadCell: r => (already.has(`${from}||${r.id}`)
          ? '<td><input type="checkbox" disabled title="已引用，无需重复引用"></td>'
          : `<td><input type="checkbox" class="ppchk" value="${r.id}" ${picked.has(r.id) ? 'checked' : ''}></td>`)
      })
      : '<div class="empty">没有符合筛选条件的产品用例（可放宽筛选条件）</div>';
    $$('.ppchk', $('#ppList')).forEach(chk => chk.onchange = () => {
      chk.checked ? picked.add(chk.value) : picked.delete(chk.value);
      $('#ppCount').textContent = picked.size;
    });
  };
  window.__pickProdRedraw = draw;
  const refreshOptions = () => {
    const all = allOf();
    syncOptions($('#ppModule'), Array.from(new Set(all.map(r => r.module).filter(Boolean))).sort());
    syncOptions($('#ppType'), Array.from(new Set(all.map(r => r.testType).filter(Boolean))).sort());
  };
  $('#ppCols').onclick = () => openColPicker('pickProd');
  $('#ppModel').onchange = () => {
    /* 切换来源产品后，之前针对其他产品的勾选不能混用 */
    if (picked.size) { picked.clear(); toast('已切换来源产品，清空之前的勾选'); }
    $('#ppModule').value = ''; $('#ppType').value = ''; refreshOptions(); draw();
  };
  ['ppModule', 'ppLevel', 'ppType', 'ppSrc'].forEach(id => { $('#' + id).onchange = draw; });
  $('#ppKw').oninput = draw;
  $('#ppAll').onclick = () => {
    const from = $('#ppModel').value;
    let n = 0;
    shownRows().forEach(r => { if (!already.has(`${from}||${r.id}`) && !picked.has(r.id)) { picked.add(r.id); n++; } });
    draw();
    toast(n ? `已在筛选结果中勾选 ${n} 条` : '筛选结果都已勾选（或无可勾选用例）');
  };
  $('#ppNone').onclick = () => { picked.clear(); draw(); };
  refreshOptions();
  draw();
  $('#ppOk').onclick = () => {
    const from = $('#ppModel').value;
    const picks = Array.from(picked);
    if (!picks.length) { toast('请勾选要引用的产品用例'); return; }
    p.prodRefs = p.prodRefs || [];
    let pr = p.prodRefs.find(x => x.fromModel === from);
    if (!pr) { pr = { fromModel: from, caseIds: [] }; p.prodRefs.push(pr); }
    let n = 0;
    picks.forEach(id => { if (!pr.caseIds.includes(id)) { pr.caseIds.push(id); n++; } });
    if (!n) { toast('所选用例已引用，无需重复引用'); return; }
    if (String(p.reviewStatus || '').indexOf('审核通过') < 0) p.reviewStatus = '待发起产品用例审核';
    log('引用产品用例', `${p.model} ← ${from}｜引用 ${n} 条（编号沿用被引用用例编号，不新增前缀）｜${picks.join('、')}`);
    closeTopModal(); renderProd();
    toast(`已从 ${from} 引用 ${n} 条用例（编号保持不变）`, 'success');
  };
};
window.viewProdRefSource = function (fromModel, id) {
  const src = DB.products.find(x => x.model === fromModel);
  const r = src ? prodCaseRows(src).find(x => x.id === id) : null;
  if (!r) { toast('未找到来源用例'); return; }
  modal(`引用来源 · ${id}`, `
    
    <table class="detail-table">
      <tr><td style="width:130px">来源产品</td><td>${fromModel}</td></tr>
      <tr><td>产品用例编号</td><td><b>${r.id}</b></td></tr>
      <tr><td>来源类型</td><td>${srcTag(r.source)}</td></tr>
      <tr><td>功能模块</td><td>${r.module}</td></tr>
      <tr><td>用例概述</td><td style="white-space:normal">${r.summary}</td></tr>
      <tr><td>前置条件</td><td style="white-space:normal">${r.pre || '—'}</td></tr>
      <tr><td>操作步骤</td><td style="white-space:normal">${r.steps || '—'}</td></tr>
      <tr><td>预期结果</td><td style="white-space:normal">${r.expect || '—'}</td></tr>
    </table>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeTopModal()">关闭</button></div>`);
};
window.removeProdRefCase = function (fromModel, id) {
  if (!guard('edit')) return;
  const p = DB.products[state.prodIndex];
  const pr = (p.prodRefs || []).find(x => x.fromModel === fromModel);
  if (!pr) return;
  confirmModal('移除产品用例引用', `<p>确定移除对 <b>${fromModel}</b> 用例 <b>${id}</b> 的引用？</p>`, () => {
    pr.caseIds = pr.caseIds.filter(x => x !== id);
    p.prodRefs = p.prodRefs.filter(x => (x.caseIds || []).length);
    log('移除产品用例引用', `${p.model}｜移除 ${fromModel} 的 ${id}`);
    closeAllModals(); renderProd(); toast('已移除引用');
  });
};
window.gotoStdModule = function (m) {
  if (!ensureTab('std')) return;
  state.tab = 'std'; state.stdModule = m ? [m] : []; state.stdModel = []; state.stdTreePath = {}; state.stdPage = 1; renderApp();
};

window.newProdCase = function () {
  if (!guard('edit')) return;
  const p = DB.products[state.prodIndex];
  formModal(`新增产品专属增补用例 · ${p.model}`, [
    {
      key: 'module', label: '功能模块（支持自定义填写）', type: 'text', list: DB.stdModules.map(m => m.name),
      placeholder: '选择或直接输入新模块名称'
    },
    { key: 'caseDomain', label: '用例领域（手工填写）', type: 'select', options: DOMAIN_OPTIONS, value: normDomain('', (p.domain ? normDomain(p.domain, '固件') : '固件')) },
    { key: 'caseSource', label: '用例来源', type: 'select', options: SOURCE_OPTIONS, value: '需求' },
    { key: 'testType', label: '测试类型', type: 'select', options: ['功能测试', '易用性测试', '兼容性测试', '性能测试', '可靠性测试', '安全测试'] },
    { key: 'summary', label: '用例概述', type: 'text' },
    { key: 'functionPoint', label: '功能点', type: 'text' },
    { key: 'testPoint', label: '测试点', type: 'text', value: '功能逻辑' },
    { key: 'level', label: '用例等级', type: 'select', options: ['L1', 'L2', 'L3'], value: 'L3' },
    { key: 'pre', label: '前置条件', type: 'textarea' },
    { key: 'steps', label: '操作步骤', type: 'textarea' },
    { key: 'input', label: '输入数据', type: 'text', value: '无' },
    { key: 'expect', label: '预期结果', type: 'textarea' },
    { key: 'remark', label: '备注', type: 'text', value: '无' },
    { key: 'testProject', label: '测试项目', type: 'text', placeholder: '不填默认取功能模块名称' },
    { key: 'minutes', label: '手动测试时间（min）', type: 'number' },
    { key: 'autoFlag', label: '自动化标志', type: 'select', options: ['否', '是'], value: '否' },
    { key: 'autoTool', label: '自动化工具', type: 'text', placeholder: '自动化标志为「是」时填写' },
    { key: 'autoTime', label: '自动化测试时间（min）', type: 'number' },
    {
      key: 'marketBug', label: '市场反馈 BUG', type: 'text', placeholder: '市场问题单号 / BUG 编号',
      dependsOn: { key: 'caseSource', equals: MARKET_SOURCE }, required: { key: 'caseSource', equals: MARKET_SOURCE }
    },
    {
      key: 'marketBugDate', label: '市场反馈时间', type: 'text', placeholder: 'YYYY-MM-DD',
      dependsOn: { key: 'caseSource', equals: MARKET_SOURCE }, required: { key: 'caseSource', equals: MARKET_SOURCE }
    }
  ], v => {
    const module = v.module.trim();
    if (!module) { toast('请填写功能模块'); return false; }
    if (!v.summary.trim()) { toast('请填写用例概述'); return false; }
    ensureModuleExists(module, v.caseDomain, '新增产品专属增补用例');
    const autoOn = v.autoFlag === '是';
    const marketOn = v.caseSource === MARKET_SOURCE;
    const seq = p.added.filter(a => String(a.id).indexOf(`${p.model}-A`) === 0).length + 1;
    p.added.push({
      id: prodCaseNo(p.model, 'A' + String(seq).padStart(2, '0')), module, domain: normDomain(v.caseDomain, '固件'),
      summary: v.summary, level: v.level, caseSource: v.caseSource,
      date: today(), reviewer: DB.currentUser, feedback: '待回流确认',
      pre: v.pre, steps: v.steps, input: v.input, expect: v.expect, remark: v.remark,
      testType: v.testType, functionPoint: v.functionPoint || module, testPoint: v.testPoint || '功能逻辑',
      testProject: v.testProject.trim() || module, minutes: v.minutes || '',
      autoFlag: v.autoFlag, autoTool: autoOn ? (v.autoTool.trim() || '—') : '—',
      autoTime: autoOn && v.autoTime !== '' ? v.autoTime : '—', autoUpdatedAt: autoOn ? today() : '—',
      bugCount: 0, bugIds: [], bugId: '—',
      marketBug: marketOn ? v.marketBug.trim() : '', marketBugDate: marketOn ? v.marketBugDate.trim() : ''
    });
    log('新增产品专属用例', `${p.model}｜${module}｜${v.testType}｜${v.summary}`);
    closeTopModal(); renderProd(); toast('已新增产品专属用例');
  });
};

window.applyReflow = function (prodCaseId) {
  if (!guard('reviewCreate', '发起审核 / 申请回流')) return;
  const p = DB.products.find(x => x.added.some(a => a.id === prodCaseId));
  const a = p.added.find(x => x.id === prodCaseId);
  /* 仅「已回流模块库」不可重复申请；「已回流产品用例库」= 已进产品库，仍需申请回流模块库 */
  const fb = String(a.feedback || '');
  if (fb.includes('已回流模块') || fb.includes('已回流（模块')) { toast('该用例已回流模块库'); return; }
  const owner = moduleOwner(a.module) || '（未指定）';
  formModal('申请回流标准库', [
    { key: 'module', label: '目标功能模块', type: 'select', options: DB.stdModules.map(m => m.name), value: a.module },
    {
      key: 'branch', label: '回流分支类型', type: 'select', options: ['产品通用', '指定产品'], value: '产品通用',
      },
    {
      key: 'refProducts', label: '适用产品型号', type: 'text', value: '', placeholder: '如 USR-N540、USR-N580（多个用「、」分隔）',
      dependsOn: { key: 'branch', equals: '指定产品' }, required: { key: 'branch', equals: '指定产品' }
    },
    { key: 'summary', label: '用例概述（写入模块库前的通用口径）', type: 'text', value: a.summary },
    { key: 'owner', label: '模块维护责任人（系统带出）', type: 'text', value: owner },
    { key: 'reason', label: '回流说明', type: 'textarea', value: '该场景具备通用性，建议纳入模块用例库标准用例。' }
  ], v => {
    if (!v.owner.trim()) { toast('该功能模块未指定维护责任人，请先在模块划分表中补充'); return false; }
    if (!v.summary.trim()) { toast('请填写用例概述'); return false; }
    const branch = normBranch(v.branch) || '产品通用';
    const models = branch === '指定产品' ? splitModels(v.refProducts) : [];
    if (branch === '指定产品' && !models.length) { toast('回流分支为「指定产品」时必须填写适用产品型号'); return false; }
    const patch = {
      module: v.module, branch: branch, refProducts: models, summary: v.summary.trim(), reason: v.reason.trim(),
      submitter: DB.currentUser, submitDate: today(), status: '待模块责任人确认', targetCase: '—'
    };
    const exist = DB.lineageProdToStd.find(l => l.prodCase === prodCaseId);
    if (exist) Object.assign(exist, patch);
    else DB.lineageProdToStd.unshift(Object.assign({ prodCase: prodCaseId, product: p.model }, patch));
    a.feedback = '待回流确认';
    log('发起回流申请', `${prodCaseId}｜${p.model}｜目标模块 ${v.module}｜分支 ${branch}${models.length ? ' · ' + models.join('、') : ''}｜责任人 ${v.owner}`);
    closeTopModal(); renderApp(); toast('回流申请已提交给模块维护责任人');
  });
};

window.newProductReview = function (model) {
  const p = DB.products.find(x => x.model === model) || DB.products[state.prodIndex];
  formModal(`发起产品用例审核 · ${p.model}`, [
    { key: 'type', label: '审核类型', type: 'select', options: ['产品测试用例', '产品测试方案'] },
    { key: 'target', label: '审核对象', type: 'text', value: `${p.model}_产品测试用例_V${p.planVersion}_${ymd()}` },
    { key: 'participants', label: '参会人员（产品项目内相关人员）', type: 'multi', options: DB.productMembers[p.model] || [], value: DB.productMembers[p.model] || [] },
    { key: 'note', label: '变更说明', type: 'textarea', value: '本次提交产品用例：引用模块用例库 + 产品专属增补。' }
  ], v => {
    if (!v.participants.length) { toast('请选择参会人员'); return false; }
    const id = nextId('PRV-2026-', DB.productReviews);
    DB.productReviews.unshift({ id, type: v.type, target: v.target, product: p.model, submitter: DB.currentUser, submitDate: today(), deadline: addDays(3), scope: '项目内（产品用例审核）', status: '审核中', participants: v.participants, opinions: [] });
    p.reviewStatus = '产品用例审核中（项目内）';
    log('发起产品用例审核', `${id}｜${v.target}｜参会 ${v.participants.join('、')}`);
    closeTopModal(); state.tab = 'reviews'; state.reviewTab = 'product'; renderApp(); toast('产品用例审核已发起，审核期限 3 个工作日');
  });
};

window.openPickProductCases = function (model) {
  const p = DB.products.find(x => x.model === model) || DB.products[state.prodIndex];
  const rows = (p.refs || []).map(r => ({ kind: 'ref', text: `${r.module} · ${r.branch}`, sub: `引用日期 ${r.date || '—'}`, count: (r.caseIds || []).length }))
    .concat((p.added || []).map(a => ({ kind: 'added', text: a.summary, sub: `${a.module} / 产品专属`, count: 1 })));
  const total = rows.reduce((n, r) => n + r.count, 0);
  modal(`产品用例范围 · ${p.model}`, `
    
    <table class="detail-table"><thead><tr><th>用例范围</th><th>说明</th><th>条数</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td style="white-space:normal">${srcTag(r.kind === 'ref' ? '引用模块库' : '产品专属增补')} ${r.text}</td><td style="white-space:normal;color:#6b7c8f">${r.sub}</td><td>${r.count}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">该产品尚未组合用例</td></tr>'}</tbody></table>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">关闭</button>
      <button class="btn btn-primary" onclick="closeTopModal();pickStdCases()">调整引用用例</button>
    </div>`);
};

/* ---------- 库间关联 ---------- */

window.openReflow = function (prodCaseId) {
  const l = DB.lineageProdToStd.find(x => x.prodCase === prodCaseId);
  if (!l) { toast('未找到该回流申请'); return; }
  const p = DB.products.find(x => x.model === l.product);
  const src = (p ? (p.added || []).find(x => x.id === prodCaseId) : null) || {};
  const owner = moduleOwner(l.module);
  const hint = `产品用例 <b>${l.prodCase}</b>（${l.product}）由 ${l.submitter} 于 ${l.submitDate} 提交回流。`
    + '确认前可对目标模块、回流分支、适用产品型号与用例内容做优化调整——调整只写入模块用例库，不回改产品侧用例。'
    + (owner ? `当前模块维护责任人：${owner}。`
      : `　<span style="color:#e74c3c">该模块未指定维护责任人</span>　<span class="link" onclick="closeTopModal();gotoModuleOwner('${l.module}')">去设置责任人</span>`)
    + (l.reason ? `<br>提交人的回流说明：${l.reason}` : '');
  formModal(`回流处理 · ${l.prodCase}`, [
    {
      key: 'module', label: '目标功能模块（支持自定义填写）', type: 'text', list: DB.stdModules.map(m => m.name),
      value: l.module, placeholder: '选择或直接输入新模块名称'
    },
    {
      key: 'branch', label: '回流分支类型', type: 'select', options: ['产品通用', '指定产品'], value: normBranch(l.branch) || '产品通用',
      },
    {
      key: 'refProducts', label: '适用产品型号', type: 'text', value: (l.refProducts || []).join('、'),
      placeholder: '如 USR-N540、USR-N580（多个用「、」分隔）',
      dependsOn: { key: 'branch', equals: '指定产品' }, required: { key: 'branch', equals: '指定产品' }
    },
    { key: 'summary', label: '用例概述', type: 'text', value: l.summary || src.summary || '' },
    { key: 'level', label: '用例等级', type: 'select', options: ['L1', 'L2', 'L3'], value: src.level || 'L3' },
    { key: 'testType', label: '测试类型', type: 'select', options: ['功能测试', '易用性测试', '兼容性测试', '性能测试', '可靠性测试', '安全测试'], value: src.testType || '功能测试' },
    { key: 'functionPoint', label: '功能点', type: 'text', value: src.functionPoint || l.module },
    { key: 'testPoint', label: '测试点', type: 'text', value: src.testPoint || '通用' },
    { key: 'pre', label: '前置条件', type: 'textarea', value: src.pre || '' },
    { key: 'steps', label: '操作步骤', type: 'textarea', value: src.steps || '' },
    { key: 'input', label: '输入数据', type: 'text', value: src.input || '无' },
    { key: 'expect', label: '预期结果', type: 'textarea', value: src.expect || '' },
    { key: 'remark', label: '备注', type: 'text', value: src.remark || '无' }
  ], v => {
    const module = v.module.trim() || l.module;
    const branch = normBranch(v.branch) || '产品通用';
    const models = branch === '指定产品' ? splitModels(v.refProducts) : [];
    if (!v.summary.trim()) { toast('请填写用例概述'); return false; }
    if (branch === '指定产品' && !models.length) { toast('回流分支为「指定产品」时必须填写适用产品型号'); return false; }
    ensureModuleExists(module, moduleDomainOf(module, src.domain), '回流写入模块用例库');
    const id = nextStdCaseId();
    DB.stdCases.unshift({
      id, module, branch, refProducts: models, level: v.level, status: '正常',
      testType: v.testType, functionPoint: v.functionPoint.trim() || module, testPoint: v.testPoint.trim() || '通用',
      summary: v.summary.trim(), pre: v.pre, steps: v.steps, input: v.input, expect: v.expect, remark: v.remark,
      domain: normDomain('', normDomain((DB.stdModules.find(m => m.name === module) || {}).domain, src.domain || '固件')),
      designer: DB.currentUser, designDate: today()
    });
    /* 回流记录按最终入库口径回写（分支 / 型号 / 概述以审核人调整后的为准） */
    l.module = module; l.branch = branch; l.refProducts = models; l.summary = v.summary.trim();
    l.status = '已回流模块库'; l.targetCase = id;
    if (p) { const a = p.added.find(x => x.id === l.prodCase); if (a) a.feedback = '已回流（模块用例 ' + id + '）'; }
    log('确认回流（写入模块库）', `${l.prodCase} → ${module} · ${branch}${models.length ? '（' + models.join('、') + '）' : ''}（新用例 ${id}）`);
    renderApp(); toast(`已回流并写入模块用例库：${id}`);
  }, hint, {
    okText: '确认回流并写入模块库',
    extraActions: '<button class="btn btn-danger" id="rejectReflow">退回</button>'
  });
  $('#rejectReflow').onclick = () => { l.status = '已退回'; log('退回回流申请', l.prodCase); closeTopModal(); renderApp(); toast('已退回'); };
};

/* ---------- 任务（引用产品用例库） ---------- */
function renderTasks() {
  const kw = state.taskKeyword.trim();
  const filtered = DB.tasks.filter(t =>
    (!kw || t.id.includes(kw) || t.name.includes(kw) || (t.caseSource || '').includes(kw)) &&
    (!state.taskType || t.type === state.taskType) &&
    (state.taskShowFinished || t.finished !== '是'));
  const pages = Math.max(1, Math.ceil(filtered.length / state.taskSize));
  state.taskPage = Math.min(state.taskPage, pages);
  const list = filtered.slice((state.taskPage - 1) * state.taskSize, state.taskPage * state.taskSize);
  const types = Array.from(new Set(DB.tasks.map(t => t.type)));
  /* 工时日历汇总：只统计当前登录账号在执行任务下填报的工时（按填报日期归档到自然日） */
  const calSum = workLogMonthSummary(state.calendar.year, state.calendar.month, DB.currentUser);
  const calSummaryText = calSum.rows.length
    ? `本月合计 <b>${calSum.hours}</b> h ｜ ${calSum.dayCount} 天有填报`
    : '本月暂无工时填报';
  $('#page').innerHTML = `
    ${state.calendarOpen ? `
    <div class="calendar">
      <div class="calendar-header">
        <button class="btn btn-ghost" onclick="changeMonth(-1)">‹ 上月</button>
        <h3>${state.calendar.year} 年 ${state.calendar.month} 月 工时日历</h3>
        <span class="cal-total" title="统计口径：仅统计当前登录账号在执行任务下填报的工时，按填报日期归档到自然日">${calSummaryText}</span>
        <div class="actions">
          <span class="cal-account" title="工时日历只统计当前登录账号填报的工时（在执行任务详情页的「工时填报」中填写）">当前账号 <b>${DB.currentUser}</b></span>
          <button class="btn btn-ghost" onclick="changeMonth(1)">下月 ›</button>
          <button class="btn btn-ghost" onclick="toggleCalendar()">▴ 收起日历</button>
        </div>
      </div>
      <div class="calendar-grid">
        ${['日', '一', '二', '三', '四', '五', '六'].map(d => `<div class="calendar-day-head">${d}</div>`).join('')}
        ${calendarDays(state.calendar.year, state.calendar.month)}
      </div>
    </div>` : ''}
    <div class="panel">
      <div class="panel-header">
        <div class="actions">
          ${can('task') ? '<button class="btn btn-primary" onclick="newTask()">＋ 创建任务</button>' : ''}
          <button class="btn btn-ghost" id="calToggle" title="展开/收起工时日历">${state.calendarOpen ? '▴ 收起工时日历' : '▾ 展开工时日历'}</button>
          <input id="taskKw" placeholder="搜索任务编号 / 名称 / 用例来源" value="${state.taskKeyword}" style="padding:7px 11px;border:1px solid var(--border-strong);border-radius:7px;font-family:inherit;min-width:240px">
          <select id="taskType" style="padding:7px 11px;border:1px solid var(--border-strong);border-radius:7px;font-family:inherit">
            <option value="">全部类型</option>${types.map(t => `<option ${state.taskType === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <button class="btn btn-ghost" id="taskSearch">搜索</button>
          <button class="btn btn-ghost" id="taskReset">重置</button>
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#55677a;cursor:pointer">
            <input type="checkbox" id="taskShowFin" ${state.taskShowFinished ? 'checked' : ''}> 显示已完结任务
          </label>
          <span class="chip">共 ${filtered.length} 条</span>
        </div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>任务编号</th><th>任务类型</th><th>任务名称</th><th>项目经理</th><th>产品经理</th><th>接口人</th><th>测试主负责人</th><th>用例来源</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${list.map(t => `<tr>
          <td>${t.id}</td><td>${t.type}</td><td>${t.name}</td><td>${t.pm || '—'}</td><td>${t.productManager || '—'}</td><td>${t.contact || '—'}</td><td>${t.testLead || '—'}</td>
          <td><span class="link" onclick="gotoProdRef('${t.caseSource}')">${t.caseSource}</span></td>
          <td>${pill(t.finished === '是' ? '已完结' : '进行中', t.finished === '是' ? 'success' : 'warn')}</td>
          
          <td><span class="link" onclick="renderTaskExec('${t.id}')">执行任务</span>
              ${t.finished === '是' && isLv1OrAbove() ? `<span class="link" onclick="reopenTask('${t.id}')">重新开启</span>` : ''}
              <span class="link" onclick="delTask('${t.id}')">删除</span></td>
        </tr>`).join('') || '<tr><td colspan="10" class="empty">没有符合条件的任务</td></tr>'}</tbody></table>
      </div>
      ${pagerFull(filtered.length, state.taskPage, pages, state.taskSize, 'taskSize')}
    </div>`;
  $('#taskSearch').onclick = () => { state.taskKeyword = $('#taskKw').value; state.taskType = $('#taskType').value; state.taskPage = 1; renderTasks(); };
  $('#taskKw').onkeydown = e => { if (e.key === 'Enter') $('#taskSearch').click(); };
  $('#taskReset').onclick = () => { state.taskKeyword = ''; state.taskType = ''; state.taskShowFinished = false; state.taskPage = 1; renderTasks(); };
  $('#taskShowFin').onchange = e => { state.taskShowFinished = e.target.checked; state.taskPage = 1; renderTasks(); };
  const tsz = $('#taskSize');
  if (tsz) tsz.onchange = () => { state.taskSize = +tsz.value; state.taskPage = 1; renderTasks(); };
  $('#calToggle').onclick = toggleCalendar;
  bindPager(p => { state.taskPage = p; renderTasks(); });
}

window.toggleCalendar = function () {
  state.calendarOpen = !state.calendarOpen;
  renderTasks();
};

window.delTask = function (taskId) {
  if (!guard('delete', '删除')) return;
  const t = DB.tasks.find(x => x.id === taskId);
  const execs = DB.execTasks.filter(e => e.taskId === taskId).length;
  confirmModal('删除任务', `<p>确定删除任务 <b>${t.name}</b>（${taskId}）？</p>${execs ? `<p style="color:#ef4444">该任务下还有 ${execs} 个执行任务，将一并删除。</p>` : ''}`, () => {
    const removedExecs = DB.execTasks.filter(e => e.taskId === taskId).map(e => e.execId);
    DB.execTasks = DB.execTasks.filter(e => e.taskId !== taskId);
    DB.tasks = DB.tasks.filter(x => x.id !== taskId);
    /* 删除不可逆：把被删对象的编号 / 名称 / 连带删除的执行任务记进日志，事后仍可追溯 */
    log('删除任务', `${taskId}｜${t.name}｜类型 ${t.type || '—'}｜项目经理 ${t.manager || '—'}`
      + `｜一并删除执行任务 ${removedExecs.length} 个${removedExecs.length ? `（${removedExecs.join('、')}）` : ''}`,
      '', { module: '任务', objType: '任务', objId: taskId });
    closeTopModal(); renderTasks(); toast('任务已删除', 'success');
  });
};
window.reopenTask = function (taskId, view) {
  if (!guard('task', '任务管理')) return;
  /* 重新开启属于高权限动作：仅一级及以上账号（最高管理员 / 一级）可执行 */
  if (!isLv1OrAbove()) {
    toast(`仅一级及以上账号可重新开启任务（当前角色：${DB.currentRole}）`, 'error');
    return;
  }
  const t = DB.tasks.find(x => x.id === taskId);
  if (!t) return;
  if (t.finished !== '是') { toast('该任务尚未结束，无需重新开启'); return; }
  confirmModal('重新开启任务', `<p>确定重新开启任务 <b>${t.name}</b>（${taskId}）？</p>
    `, () => {
    t.finished = '否';
    log('重新开启任务', `${taskId}｜${t.name}｜操作人 ${DB.currentUser}（${DB.currentRole}）`);
    closeTopModal();
    if (view === 'exec') renderTaskExec(taskId); else renderTasks();
    toast('任务已重新开启', 'success');
  }, '确定重新开启');
};
window.gotoProdRef = function (src) {
  const m = (src.match(/(USR-[A-Za-z0-9-]+)/) || [])[1];
  if (!m) { toast('该任务尚未关联产品用例库'); return; }
  gotoProd(m);
};
/* 工时日历数据源：统计「当前登录账号在执行任务下填报的工时」（填报记录存放在各执行任务的 workLogs）。
   传入人员姓名即只取该人的填报记录，日历固定传入 DB.currentUser。 */
function workLogRecords(y, m, person) {
  const out = [];
  const prefix = `${y}-${p2(m)}`;
  (DB.execTasks || []).forEach(e => {
    (e.workLogs || []).forEach(w => {
      const d = String(w.date || '');
      if (d.slice(0, 7) !== prefix) return;
      if (person && w.person !== person) return;
      out.push({ date: d, person: w.person || '—', hours: +w.hours || 0, execId: e.execId, name: e.name || '', taskId: e.taskId });
    });
  });
  return out;
}
/* 本月工时汇总：合计小时 / 有填报的天数 */
function workLogMonthSummary(y, m, person) {
  const rows = workLogRecords(y, m, person);
  return {
    rows: rows,
    hours: round2(rows.reduce((s, r) => s + r.hours, 0)),
    dayCount: new Set(rows.map(r => r.date)).size
  };
}
function calendarDays(y, m) {
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const today = new Date();
  /* 只统计当前登录账号的填报工时 */
  const me = DB.currentUser;
  /* 按日期聚合：日期 → 合计小时 + 各执行任务的小时明细 */
  const byDate = new Map();
  workLogRecords(y, m, me).forEach(r => {
    if (!byDate.has(r.date)) byDate.set(r.date, { total: 0, tasks: new Map() });
    const cell = byDate.get(r.date);
    cell.total = round2(cell.total + r.hours);
    const cur = cell.tasks.get(r.execId) || { hours: 0, name: r.name };
    cur.hours = round2(cur.hours + r.hours);
    cell.tasks.set(r.execId, cur);
  });
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  let html = '';
  for (let i = 0; i < first; i++) html += '<div class="calendar-day"></div>';
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${p2(m)}-${p2(d)}`;
    const rec = byDate.get(date);
    const isToday = today.getFullYear() === y && today.getMonth() + 1 === m && today.getDate() === d;
    const tasks = rec ? Array.from(rec.tasks).sort((a, b) => b[1].hours - a[1].hours) : [];
    const shown = tasks.slice(0, 3);
    const tip = rec ? `${date} 合计 ${rec.total} h：${tasks.map(([id, t]) => `${t.name || ''}（${id}）${t.hours} h`).join('；')}` : '';
    html += `<div class="calendar-day${isToday ? ' today' : ''}${rec ? ' has-work' : ''}">
      <div class="cal-daynum">${d}${rec ? `<span class="cal-badge" title="${esc(tip)}">${rec.total} h</span>` : ''}</div>
      ${shown.map(([id, t]) => `<span class="cal-person" title="${esc(`${t.name || ''}（${id}）：${date} 填报 ${t.hours} h`)}">${esc(String(id).slice(-6))} <b>${t.hours}</b>h</span>`).join('')}
      ${tasks.length > shown.length ? `<span class="cal-person more">等 ${tasks.length} 个执行任务</span>` : ''}
    </div>`;
  }
  return html;
}
function changeMonth(delta) {
  state.calendar.month += delta;
  if (state.calendar.month > 12) { state.calendar.month = 1; state.calendar.year++; }
  if (state.calendar.month < 1) { state.calendar.month = 12; state.calendar.year--; }
  renderApp();
}

window.newTask = function () {
  if (!guard('task', '任务管理')) return;
  formModal('创建任务', [
    { key: 'type', label: '任务类型', type: 'select', options: ['常规任务', '项目任务', '物料验证'] },
    { key: 'name', label: '任务名称', type: 'text' },
    { key: 'pm', label: '项目经理', type: 'text', value: DB.currentUser },
    { key: 'pm2', label: '产品经理', type: 'text', value: DB.currentUser },
    { key: 'contact', label: '接口人', type: 'text', value: '' },
    { key: 'lead', label: '测试主负责人', type: 'text', value: '' },
    { key: 'model', label: '引用产品用例库', type: 'select', options: ['待关联'].concat(DB.products.map(p => p.model)) }
  ], v => {
    if (!v.name.trim()) { toast('请填写任务名称'); return false; }
    const id = 'RW' + ymd() + String(DB.tasks.length + 41).padStart(5, '0');
    const p = DB.products.find(x => x.model === v.model);
    DB.tasks.unshift({ id, type: v.type, name: v.name, pm: v.pm, productManager: v.pm2, contact: v.contact, testLead: v.lead, finished: '否', caseSource: p ? `产品用例库 · ${p.model} ${p.planVersion}` : '产品用例库 · 待关联' });
    log('创建任务', `${id}｜${v.name}｜用例来源 ${p ? p.model : '待关联'}`);
    closeTopModal(); renderTasks(); toast('任务已创建：' + id);
  });
};

window.renderTaskExec = function (taskId) {
  const task = DB.tasks.find(t => t.id === taskId) || DB.tasks[0];
  state.currentTaskId = task.id;
  const execs = DB.execTasks.filter(e => e.taskId === task.id);
  const logs = DB.logs.filter(l => l.taskId === task.id).concat(DB.taskLogs.filter(l => l.taskId === task.id))
    .sort((a, b) => (a.time < b.time ? 1 : -1));
  $('#page').innerHTML = `
    <div class="pagehead">
      <button class="btn btn-ghost" onclick="state.tab='tasks';renderApp()">← 返回任务列表</button>
      <h2 class="panel-title">${task.name}测试任务</h2>
      ${pill(task.finished === '是' ? '已完结' : '进行中', task.finished === '是' ? 'success' : 'warn')}
      <span class="hint" style="margin:0">任务编号 ${task.id}　用例来源：${task.caseSource}</span>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="actions">
          <button class="btn btn-primary" onclick="newExecTask('${task.id}')">＋ 创建执行任务</button>
          <button class="btn btn-ghost" onclick="openTaskDetail('${task.id}')">任务详情</button>
          ${task.finished === '是'
        ? (isLv1OrAbove()
          ? `<button class="btn btn-ghost" onclick="reopenTask('${task.id}','exec')">重新开启</button>`
          : '<span class="hint" style="margin:0;color:#8a9aab">任务已完结，重新开启需一级及以上账号操作</span>')
        : `<button class="btn btn-danger" onclick="endTask('${task.id}')">结束任务</button>`}
        </div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th style="width:250px">执行任务 / 执行人</th><th style="width:60px">计划数</th><th style="width:56px">实际</th><th style="width:50px">通过</th><th style="width:50px">失败</th><th style="width:50px">阻塞</th><th style="width:60px">未执行</th><th style="width:60px">发散</th><th style="width:80px">进度</th><th style="width:246px">操作</th></tr></thead>
        <tbody>${execs.map(e => {
          const st = execStats(e);
          const ps = execProgressOf(e);
          const done = e.finished === true;
          const group = state.execGroupByPerson;
          /* 执行人权限：执行人只能操作自己名下的用例 */
          const extRole = execRoleOf(e);
          const head = `<tr class="group-row">
            <td>
              <b>${e.execId}</b> ${done ? '<span class="chip chip-warn">已结束</span>' : ''}
              <div class="group-meta">${e.name}｜${e.model}｜${e.domain}｜第 ${e.round} 轮</div>
              <div class="group-meta">HW ${e.hwVersion} / FW ${e.fwVersion}　<span title="${execEffortTip(e)}">预估投入工作量 ${execEffortText(e)}</span>　合计 ${st.actual}/${execPlanned(e)} 条${ps.length > 1 ? `　${ps.length} 位执行人` : ''}${execWorkLogsTotal(e) ? `　已填报 ${execWorkLogsTotal(e)} h` : ''}${e.finishedAt ? `　结束于 ${e.finishedAt}` : ''}</div>
            </td>
            <td colspan="9" class="group-actions">
              ${done
                ? `<span class="link" onclick="openExecDetail('${e.execId}')">查看</span>
                   ${isLv1OrAbove() ? `<span class="link" onclick="reopenExec('${e.execId}')">重新开启</span>` : '<span class="hint" style="margin:0;color:#8a9aab">重新开启需一级及以上账号</span>'}`
                : `<span class="link" onclick="addCasesToExec('${e.execId}')">添加用例</span>
                   <span class="link" onclick="openExecCases('${e.execId}')">全部执行人</span>
                   <span class="link" onclick="openDivideExecFor('${e.execId}')">调整执行人分配</span>
                   <span class="link" onclick="openExecDetail('${e.execId}')">查看</span>
                   <span class="link" onclick="editExec('${e.execId}')">修改</span>
                   <span class="link" onclick="endExecTaskFor('${e.execId}')">结束执行任务</span>
                   <span class="link" onclick="delExec('${e.execId}')">删除</span>`}
              ${ps.length > 1 ? `　<span class="link" onclick="toggleExecGroup()">${group ? '收起执行人明细' : '按执行人展开'}</span>` : ''}
            </td></tr>`;
          const personRows = !group ? ''
            : (ps.length
              ? ps.map((p, pi) => {
                const pp = p.planned ? Math.round(p.actual * 100 / p.planned) : 0;
                const unassigned = p.name === '未分配';
                const canFill = !unassigned && (extRole.isManager || p.name === extRole.me);
                return `<tr class="person-row${unassigned ? ' unassigned' : ''}">
                <td><span class="tree-mark">└</span> 执行人：<b>${p.name}</b>${unassigned ? '<span class="chip chip-warn" style="margin-left:6px">待指派</span>' : ''}
                  <div class="group-meta">该执行人负责 ${p.planned} 条用例</div></td>
                <td>${p.planned}</td><td>${p.actual}</td><td>${p.passed}</td><td>${p.failed}</td><td>${p.blocked}</td><td>${p.notRun}</td><td>${p.diverged || 0}</td>
                <td><div class="prog-sm"><span style="width:${pp}%"></span></div><small>${pp}%</small></td>
                <td>
                  <div class="op-btns">${done
                    ? `<button class="btn btn-ghost btn-sm" onclick="openExecDetail('${e.execId}')">查看</button>`
                    : `<button class="btn btn-primary btn-sm" onclick="openExecCases('${e.execId}','${p.name}')">开始执行</button>
                       ${(extRole.isManager || p.name === extRole.me)
                      ? `<button class="btn btn-ghost btn-sm" onclick="transferByExecutor('${e.execId}','${p.name}')">移交</button>`
                      : `<span class="hint" style="margin:0">他人用例仅可查看</span>`}`}</div>
                  ${canFill ? workHourBar(e, p.name, pi) : ''}
                </td></tr>`;
              }).join('')
              : `<tr class="person-row"><td colspan="10" class="empty">${done ? '该执行任务未添加用例' : '尚未添加用例，请点击「添加用例」并指定执行人'}</td></tr>`);
          return head + personRows;
        }).join('') || '<tr><td colspan="10" class="empty">暂无执行任务，点击「创建执行任务」开始</td></tr>'}</tbody></table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">任务日志 <span class="chip">${logs.length} 条</span></h2>
        <span class="hint" style="margin:0"><span class="link" onclick="openMyLogs()">查看全部 / 筛选</span></span>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th style="width:120px">任务编号</th><th style="width:140px">执行任务编号</th><th style="width:150px">操作时间</th><th style="width:120px">操作人</th><th style="width:90px">模块</th><th>操作事项 / 变更明细</th></tr></thead>
        <tbody>${logs.slice(0, 300).map(l => `<tr><td>${l.taskId}</td><td>${l.execId || '—'}</td><td>${l.time}</td><td>${l.operator || l.user}${l.role ? `（${l.role}）` : ''}</td>
          <td>${logModuleOfRecord(l)}</td>
          <td style="white-space:normal">${l.action}${l.detail ? '｜' + l.detail : ''}${(l.count || 1) > 1 ? ` <span class="chip chip-warn" title="连续修改已合并">合并 ${l.count} 次</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">暂无日志</td></tr>'}</tbody></table>
      </div>
    </div>`;
};

/* ===== 工时填报（任务详情页：每个执行人的操作区，默认填报日期为当天） ===== */
function execWorkLogsOf(e, person) {
  return (e.workLogs || []).filter(w => w.person === person);
}
function round2(n) { return Math.round(n * 100) / 100; }
function execWorkLogsSum(e, person) {
  return round2(execWorkLogsOf(e, person).reduce((s, w) => s + (+w.hours || 0), 0));
}
function execWorkLogsTotal(e) {
  return round2((e.workLogs || []).reduce((s, w) => s + (+w.hours || 0), 0));
}
/* 执行人行操作区内的工时填报控件：工时输入框 + 填报日期（默认当天） + 填报按钮 */
function workHourBar(e, person, pi) {
  const recs = execWorkLogsOf(e, person);
  const sum = execWorkLogsSum(e, person);
  const key = `wh_${e.execId}_${pi}`;
  const detail = recs.length ? recs.map(w => `${w.date} ${w.hours} h`).join('；') : '暂无填报记录';
  return `<div class="whbar" title="工时填报：填写工时并选择填报日期（默认当天）">
      <input type="number" id="${key}-h" class="wh-hour" min="0" step="0.5" placeholder="工时" title="填报工时（小时）">
      <input type="date" id="${key}-d" class="wh-date" value="${today()}" title="填报日期，默认当天">
      <button class="btn btn-ghost btn-sm" onclick="fillWorkHour('${e.execId}',${pi})">填报</button>
    </div>${recs.length ? `<div class="wh-sum" title="${detail}">累计已填报 <b>${sum}</b> h</div>` : ''}`;
}
window.fillWorkHour = function (execId, pi) {
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e) return;
  const p = execProgressOf(e)[pi];
  if (!p) return;
  const hEl = document.getElementById(`wh_${execId}_${pi}-h`);
  const dEl = document.getElementById(`wh_${execId}_${pi}-d`);
  if (!hEl) return;
  const hours = Number(hEl.value);
  const date = (dEl && dEl.value) || today();
  if (!hours || isNaN(hours) || hours <= 0) { toast('请填写大于 0 的工时（小时）'); hEl.focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('请选择填报日期'); if (dEl) dEl.focus(); return; }
  if (!e.workLogs) e.workLogs = [];
  /* 同一执行人同一天重复填报按累加处理（日志记录累加前后值，便于核对工时来源） */
  const exist = e.workLogs.find(w => w.person === p.name && w.date === date);
  const beforeHours = exist ? (+exist.hours || 0) : 0;
  if (exist) exist.hours = round2(beforeHours + hours);
  else e.workLogs.push({ person: p.name, date, hours, at: nowStr(), by: DB.currentUser });
  log('工时填报', `${execId}｜执行人 ${p.name}｜日期 ${date}｜本次填报 ${hours} h｜${p.name} 当日累计「${beforeHours} h」→「${round2(beforeHours + hours)} h」｜填报人 ${DB.currentUser}`,
    e.taskId, {
      module: '执行', objType: '工时', objId: `${execId}|${p.name}`,
      changes: [{ field: `${p.name} ${date} 工时`, from: `${beforeHours} h`, to: `${round2(beforeHours + hours)} h` }]
    });
  save();
  renderTaskExec(e.taskId);
  toast(`已填报工时：${p.name} ${date} ${hours} h`, 'success');
};

function execItemsOf(e) { return e.items || []; }
/* 执行人列表（支持空格 / 顿号 / 逗号分隔） */
function executorsOf(e) { return String(e.executors || '').split(/[\s、,]+/).filter(Boolean); }
/* 单批用例统计 */
function countRows(rows) {
  const t = { planned: rows.length, actual: 0, passed: 0, failed: 0, blocked: 0, notRun: 0 };
  rows.forEach(r => {
    if (!r.result || r.result === 'N/A' || r.result === '未执行') { t.notRun++; return; }
    t.actual++;
    if (r.result === 'Pass') t.passed++;
    else if (r.result === 'Fail') t.failed++;
    else if (r.result === '阻塞') t.blocked++;
  });
  return t;
}
/* 每个执行人负责的用例数与进度（任务列表中每个执行人一行的数据来源） */
function execProgressOf(e) {
  const all = execCaseRows(e);
  const stats = e.execStats || [];
  return executorScopes(e).map(p => {
    const s = stats.find(x => x.name === p);
    if (s && s.planned) return { name: p, planned: s.planned, actual: s.actual || 0, passed: s.passed || 0, failed: s.failed || 0, blocked: s.blocked || 0, notRun: s.notRun || 0, diverged: s.diverged || 0 };
    const t = countRows(all.filter(r => r.executor === p));
    return { name: p, planned: t.planned, actual: t.actual, passed: t.passed, failed: t.failed, blocked: t.blocked, notRun: t.notRun, diverged: 0 };
  });
}
/* 按执行人重新汇总（多人执行任务的核心） */
function recomputeExecStats(e) {
  const all = execCaseRows(e);
  all.forEach(r => { if (!r.executor) r.executor = '未分配'; });
  const names = [];
  all.forEach(r => { if (!names.includes(r.executor)) names.push(r.executor); });
  e.execStats = names.map(name => {
    const rs = all.filter(r => r.executor === name);
    const t = countRows(rs);
    return { name, planned: t.planned, actual: t.actual, passed: t.passed, failed: t.failed, blocked: t.blocked, notRun: t.notRun, diverged: 0 };
  });
  e.totals = countRows(all);
  return e.execStats;
}
/* 指定范围（全部执行人 / 某人）的统计 */
function scopeStats(e, scope) {
  const all = execCaseRows(e);
  if (scope && scope !== 'all') {
    const s = (e.execStats || []).find(x => x.name === scope);
    if (s) return s;
    return countRows(all.filter(r => r.executor === scope));
  }
  if (e.totals) return e.totals;
  return countRows(all);
}
/* 说明：来自产品用例库、由本平台维系的执行任务（有 items）按行实时统计；
   历史执行任务（只有 execRows 样例 + 全量 totals）保留其全量统计 */
function execPlanned(e) {
  if (!e.items && e.totals) return e.totals.planned;
  return execCaseRows(e).length;
}
function execPending(e) {
  if (!e.items && e.totals) return e.totals.notRun;
  return countRows(execCaseRows(e)).notRun;
}
function execStats(e) {
  if (!e.items && e.totals) {
    const t = e.totals;
    return { actual: t.actual, passed: t.passed, failed: t.failed, blocked: t.blocked, notRun: t.notRun, planned: t.planned };
  }
  const t = countRows(execCaseRows(e));
  return { actual: t.actual, passed: t.passed, failed: t.failed, blocked: t.blocked, notRun: t.notRun, planned: t.planned };
}
function rate(a, b) { return b ? Math.round(a * 100 / b) + '%' : '0%'; }
/* 预估投入工作量：把执行任务内用例「手动测试时间(min)」合计后换算成小时。
   「投入工作量」字段已下线，改由导入的执行用例自带执行时间自动统计（保留 1 位小数）；
   没有用例明细的历史复刻任务不显示 0，而是显示「—」。 */
function execEffort(e) {
  const rows = execCaseRows(e);
  const minutes = rows.reduce((n, r) => {
    const v = parseFloat(String(r.manualMin == null ? '' : r.manualMin).replace(/[^0-9.]/g, ''));
    return n + (isNaN(v) || v <= 0 ? 0 : v);
  }, 0);
  return { rows: rows.length, minutes: minutes, hours: Math.round(minutes / 60 * 10) / 10 };
}
function execManualMinutes(e) { return execEffort(e).minutes; }
function execEffortHours(e) { return execEffort(e).hours; }
/* 预估投入工作量展示文本：无时间数据时不显示 0，而是显示「—」
   （既包含没有用例明细的历史执行任务，也包含用例均未填写手动测试时间的情况） */
function execEffortText(e) { const eff = execEffort(e); return eff.hours ? `${eff.hours} h` : '—'; }
/* 预估投入工作量的悬浮说明：写明统计口径、用例条数与合计分钟数 */
function execEffortTip(e) {
  const eff = execEffort(e);
  if (!eff.rows) return '预估投入工作量：该执行任务暂无用例明细，添加用例后按用例手动测试时间自动统计';
  if (!eff.minutes) return `预估投入工作量：本次 ${eff.rows} 条用例均未填写「手动测试时间」，暂无法统计（可在用例库或执行明细中补充）`;
  return `预估投入工作量：按本次执行任务内 ${eff.rows} 条用例的「手动测试时间」合计 ${eff.minutes} min 换算（${eff.hours} h）`;
}

window.newExecTask = function (taskId) {
  if (!guard('task', '任务管理')) return;
  const task = DB.tasks.find(t => t.id === taskId);
  formModal('创建执行任务', [
    { key: 'name', label: '执行任务名称', type: 'text', value: `${task.name}测试` },
    { key: 'model', label: '产品型号（决定用例来源）', type: 'select', options: DB.products.map(p => p.model) },
    { key: 'domain', label: '领域', type: 'select', options: ['硬件', '固件'] },
    { key: 'round', label: '轮数', type: 'number', value: 1 },
    { key: 'hw', label: '硬件版本', type: 'text' },
    { key: 'fw', label: '固件版本', type: 'text' },
    { key: 'executors', label: '执行人（多人用空格分隔；各人执行哪些用例在「添加用例」时指定）', type: 'text', value: '' }
  ], v => {
    if (!v.name.trim()) { toast('请填写执行任务名称'); return false; }
    const id = 'ZXRW' + ymd() + String(DB.execTasks.length + 160).padStart(4, '0');
    /* 「投入工作量」不再人工填写：添加用例后按用例的手动测试时间自动统计（见 execEffortHours） */
    const ne = { execId: id, taskId, name: v.name, model: v.model, domain: v.domain, round: v.round, hwVersion: v.hw, fwVersion: v.fw, items: [], executors: v.executors, diverged: 0, caseSource: `产品用例库 · ${v.model}` };
    DB.execTasks.push(ne);
    recomputeExecStats(ne);
    log('创建执行任务', `${id}｜${v.name}｜用例来源 产品用例库 ${v.model}｜执行人 ${v.executors}（待添加用例并指定执行人）`, taskId);
    closeTopModal(); renderTaskExec(taskId); toast('执行任务已创建：' + id + '，请「添加用例」并指定执行人（预估投入工作量按用例执行时间自动统计）');
  });
};

window.editExec = function (execId) {
  if (!guard('task', '任务管理')) return;
  const e = DB.execTasks.find(x => x.execId === execId);
  formModal(`编辑执行任务 · ${execId}`, [
    { key: 'name', label: '执行任务名称', type: 'text', value: e.name },
    { key: 'domain', label: '领域', type: 'select', options: ['硬件', '固件'], value: e.domain },
    { key: 'round', label: '轮数', type: 'number', value: e.round },
    { key: 'hwVersion', label: '硬件版本', type: 'text', value: e.hwVersion },
    { key: 'fwVersion', label: '固件版本', type: 'text', value: e.fwVersion },
    { key: 'executors', label: '执行人（多人用空格分隔，变更后需重新划分用例）', type: 'text', value: e.executors }
  ], v => {
    if (!v.name.trim()) { toast('请填写执行任务名称'); return false; }
    const snap = {
      name: e.name, model: e.model, domain: e.domain, round: e.round,
      hwVersion: e.hwVersion, fwVersion: e.fwVersion, executors: executorsOf(e).join('、')
    };
    Object.assign(e, { name: v.name, domain: v.domain, round: v.round, hwVersion: v.hwVersion, fwVersion: v.fwVersion, executors: v.executors });
    execCaseRows(e);
    recomputeExecStats(e);
    /* 字段级留痕：名称 / 领域 / 轮数 / 硬件版本 / 固件版本 / 执行人，逐项「原值 → 现值」 */
    logEdit('编辑执行任务', snap, {
      name: e.name, model: e.model, domain: e.domain, round: e.round,
      hwVersion: e.hwVersion, fwVersion: e.fwVersion, executors: executorsOf(e).join('、')
    }, EXEC_LOG_FIELDS, { module: '执行', objType: '执行任务', objId: execId, taskId: e.taskId, head: execId });
    const after = executorsOf(e);
    closeTopModal(); renderTaskExec(e.taskId);
    toast(after.length > 1 ? '已保存修改，可在任务行点「调整执行人分配」重新归属用例' : '已保存修改', 'success');
  });
};

/* 上一轮（同任务、同产品型号、更低轮次中最近一轮）结果未通过 / 阻塞 / 未执行的用例 */
function prevRoundCases(e) {
  const rounds = DB.execTasks.filter(x => x.taskId === e.taskId && x.model === e.model && x.execId !== e.execId && (x.round || 1) < (e.round || 1));
  if (!rounds.length) return { execId: '', round: 0, cases: [] };
  rounds.sort((a, b) => (b.round || 1) - (a.round || 1));
  const prev = rounds[0];
  const bad = [];
  execCaseRows(prev).forEach(r => {
    const res = r.result || '';
    /* 空（未选择）与 N/A / 未执行 一并视为「未通过」，纳入沿用的候选 */
    if ((!res || res === 'Fail' || res === '阻塞' || res === '未执行' || res === 'N/A') && bad.indexOf(r.summary) < 0) bad.push(r.summary);
  });
  const p = DB.products.find(x => x.model === e.model);
  const pool = (p ? prodCaseRows(p) : []).filter(c => c.status !== '停用');
  const rows = execCaseRows(e);
  const cases = [];
  bad.forEach(sm => {
    const hit = pool.find(c => c.summary === sm);
    if (hit && !rows.some(i => i.summary === sm) && !cases.some(c => c.summary === sm)) cases.push(hit);
  });
  return { execId: prev.execId, round: prev.round || 1, cases };
}
window.addCasesToExec = function (execId) {
  const e = DB.execTasks.find(x => x.execId === execId);
  const p = DB.products.find(x => x.model === e.model);
  if (!p) { toast('该执行任务未关联产品用例库'); return; }
  const people = executorsOf(e);
  if (!people.length) { toast('该执行任务未设置执行人，请先在「修改」中填写执行人'); return; }
  /* 执行人身份只能给自己添加用例；任务管理角色可为任意执行人添加 */
  const erAdd = execRoleOf(e);
  const addPeople = (erAdd.isExecutor && !erAdd.isManager) ? [erAdd.me] : people;
  const rows = execCaseRows(e);
  /* 待添加用例全集：引用模块库 / 引用产品用例 / 产品专属增补统一成一份列表——
     添加执行任务用例时不需要关注用例来源，页面上也不展示来源。
     已停用的用例不可添加（不展示，仅提示过滤条数）。 */
  const allRows = prodCaseRows(p);
  const avail = allRows.filter(r => r.status !== '停用');
  const offSkipped = allRows.length - avail.length;
  const byId = new Map();
  avail.forEach(r => { if (!byId.has(r.id)) byId.set(r.id, r); });
  const isAdded = r => rows.some(i => i.summary === r.summary);
  const newableOf = list => list.filter(r => !isAdded(r));
  const modules = Array.from(new Set(avail.map(r => r.module))).sort();
  const picked = new Set();   /* 已选产品用例编号：两种视图共用同一份选择，切换视图不丢失 */
  let view = 'cases';
  let kw = '';
  const escAdd = t => String(t == null ? '' : t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const countBy = name => rows.filter(r => r.executor === name).length;
  /* 上一轮同任务同产品型号码、结果为 未通过 / 阻塞 / 未执行 的用例，支持一键沿用 */
  const prev = prevRoundCases(e);
  modal('添加用例 · ' + e.execId + '（' + e.model + '）', `
    
    <table class="detail-table">
      <tr><td style="width:120px">执行人：</td>
        <td><select id="addExecutor">${addPeople.map(x => `<option>${x}</option>`).join('')}</select>
        <span class="hint" style="margin-left:12px">当前该执行人名下已有 <b id="addCur">${countBy(addPeople[0])}</b> 条用例${(erAdd.isExecutor && !erAdd.isManager) ? '　（执行人只能给自己添加用例）' : ''}</span></td></tr>
      <tr><td>沿用上一轮：</td>
        <td>${prev.execId
      ? `<button class="btn btn-ghost btn-sm" id="usePrev">一键沿用 ${prev.execId}（第 ${prev.round} 轮）未通过 / 阻塞 / 未执行的用例（${prev.cases.length} 条）</button>
         `
      : '<span class="hint" style="margin:0">本任务暂无更早轮次的执行记录可用于沿用</span>'}</td></tr>
      <tr><td>过往执行记录：</td>
        <td><button class="btn btn-ghost btn-sm" id="useFromExec">从其他执行任务导入用例（含已完结 / 归档任务）</button>
        </td></tr>
    </table>
    <div class="pickbar" style="margin:12px 0 6px">
      <button class="btn btn-sm btn-primary" id="addViewCases">用例列表</button>
      <button class="btn btn-sm btn-ghost" id="addViewModules">功能模块列表</button>
      <input id="addKw" placeholder="搜索用例编号 / 概述 / 功能模块" style="width:240px">
      <button class="btn btn-ghost btn-sm" id="addSelectAll">全选可新增</button>
      <button class="btn btn-ghost btn-sm" id="addClear">清空已选</button>
      <span class="hint" style="margin:0" id="addPickedTip"></span>
    </div>
    <div class="table-wrap" id="addListArea" style="max-height:44vh"></div>
    <div class="form-actions">
      <span class="hint" style="margin:0" id="addPreview"></span>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="okAdd">添加到该执行人</button>
    </div>`);
  const syncPreview = () => {
    const to = $('#addExecutor').value;
    if ($('#addCur')) $('#addCur').textContent = countBy(to);
    const list = Array.from(picked).map(id => byId.get(id)).filter(r => r && !isAdded(r));
    if ($('#addPreview')) $('#addPreview').textContent = `本次将给 ${to} 添加 ${list.length} 条用例`;
    if ($('#addPickedTip')) {
      $('#addPickedTip').textContent = `已选 ${picked.size} 条${picked.size !== list.length ? `（含 ${picked.size - list.length} 条已加入）` : ''}`;
    }
    const vc = $('#addViewCases'), vm = $('#addViewModules');
    if (vc) vc.className = 'btn btn-sm ' + (view === 'cases' ? 'btn-primary' : 'btn-ghost');
    if (vm) vm.className = 'btn btn-sm ' + (view === 'modules' ? 'btn-primary' : 'btn-ghost');
  };
  /* 列表区渲染：① 用例列表（逐条勾选）② 功能模块列表（按功能模块整块勾选） */
  const drawList = () => {
    const area = $('#addListArea');
    if (!area) return;
    const k = kw.trim().toLowerCase();
    if (view === 'cases') {
      const list = avail.filter(r => !k
        || String(r.id).toLowerCase().indexOf(k) >= 0
        || String(r.summary || '').toLowerCase().indexOf(k) >= 0
        || String(r.module || '').toLowerCase().indexOf(k) >= 0);
      area.innerHTML = `<table><thead><tr><th style="width:50px">选择</th><th style="width:215px">产品用例编号</th>
        <th style="width:130px">功能模块</th><th style="width:86px">分支类型</th><th style="width:70px">用例等级</th>
        <th>用例概述</th><th style="width:84px">状态</th></tr></thead>
        <tbody>${list.map(r => `<tr>
          <td><input type="checkbox" class="pickcase" value="${escAdd(r.id)}" ${isAdded(r) ? 'disabled' : ''} ${picked.has(r.id) ? 'checked' : ''}></td>
          <td>${escAdd(r.id)}</td><td>${escAdd(r.module)}</td><td>${escAdd(r.branch)}</td><td>${escAdd(r.level)}</td>
          <td style="white-space:normal">${escAdd(r.summary)}</td>
          <td>${isAdded(r) ? '<span class="pill pill-gray">已加入</span>' : '<span class="pill pill-success">可新增</span>'}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">没有符合条件的用例</td></tr>'}</tbody></table>`;
      $$('.pickcase').forEach(c => c.onchange = () => {
        if (c.checked) picked.add(c.value); else picked.delete(c.value);
        syncPreview();
      });
    } else {
      const list = modules.filter(m => !k || String(m).toLowerCase().indexOf(k) >= 0);
      area.innerHTML = `<table><thead><tr><th style="width:50px">选择</th><th>功能模块</th>
        <th style="width:90px">用例数</th><th style="width:90px">可新增</th><th style="width:90px">已加入</th><th style="width:110px">本模块已选</th></tr></thead>
        <tbody>${list.map(m => {
        const all = avail.filter(r => r.module === m);
        const news = newableOf(all);
        const sel = news.filter(r => picked.has(r.id)).length;
        return `<tr>
          <td><input type="checkbox" class="pickmod" value="${escAdd(m)}" ${news.length ? '' : 'disabled'} ${news.length && sel === news.length ? 'checked' : ''}></td>
          <td>${escAdd(m)}</td><td>${all.length}</td><td>${news.length}</td><td>${all.length - news.length}</td>
          <td>${sel ? `<b>${sel}</b>` : '—'}</td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">没有符合条件的功能模块</td></tr>'}</tbody></table>`;
      /* 部分已选 → 半选状态（indeterminate 必须在渲染后设置）；勾选即整块选中该模块下的可新增用例 */
      $$('.pickmod').forEach(cb => {
        const news = newableOf(avail.filter(r => r.module === cb.value));
        const sel = news.filter(r => picked.has(r.id)).length;
        cb.indeterminate = !!news.length && sel > 0 && sel < news.length;
        cb.onchange = () => {
          news.forEach(x => { if (cb.checked) picked.add(x.id); else picked.delete(x.id); });
          drawList();
        };
      });
    }
    syncPreview();
  };
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1180px, 96vw)';
  $('#addViewCases').onclick = () => { view = 'cases'; drawList(); };
  $('#addViewModules').onclick = () => { view = 'modules'; drawList(); };
  $('#addKw').oninput = ev => { kw = ev.target.value; drawList(); };
  $('#addSelectAll').onclick = () => { newableOf(avail).forEach(r => picked.add(r.id)); drawList(); };
  $('#addClear').onclick = () => { picked.clear(); drawList(); };
  $('#addExecutor').onchange = syncPreview;
  drawList();
  const ufe = $('#useFromExec');
  if (ufe) ufe.onclick = () => { closeTopModal(); openImportFromExec(execId); };
  const usePrev = $('#usePrev');
  if (usePrev) usePrev.onclick = () => {
    const to = $('#addExecutor').value;
    if (!prev.cases.length) { toast('上一轮没有可沿用的用例'); return; }
    confirmModal('沿用上一轮用例', `<p>把 <b>${prev.execId}</b>（第 ${prev.round} 轮）中未通过 / 阻塞 / 未执行的 <b>${prev.cases.length}</b> 条用例加入当前执行任务，执行人为 <b>${to}</b>。</p>
      `, () => {
      let added = 0;
      prev.cases.forEach(c => {
        if (rows.some(i => i.summary === c.summary)) return;
        rows.push({ id: c.id, module: c.module, branch: c.branch, summary: c.summary, level: c.level, source: c.source, result: '', note: '', executor: to });
        added++;
      });
      recomputeExecStats(e);
      log('沿用上一轮用例', `${e.execId}｜来源 ${prev.execId}（第 ${prev.round} 轮）｜执行人 ${to}｜新增 ${added} 条`, e.taskId);
      closeAllModals(); renderTaskExec(e.taskId);
      toast(`已沿用 ${added} 条用例给 ${to}`, 'success');
    }, '确认沿用');
  };
  $('#okAdd').onclick = () => {
    const to = $('#addExecutor').value;
    const list = Array.from(picked).map(id => byId.get(id)).filter(r => r && !isAdded(r));
    if (!list.length) { toast('请先选择要添加的用例'); return; }
    let added = 0;
    list.forEach(r => {
      if (rows.some(i => i.summary === r.summary)) return;
      rows.push({
        id: r.id, module: r.module, branch: r.branch, summary: r.summary, level: r.level,
        source: r.source, result: '', note: '', executor: to,
        /* 内容字段随用例一并写入执行行：导入后前置条件 / 操作步骤 / 输入数据 / 预期结果等立即可见 */
        testType: r.testType, testPoint: r.testPoint, functionPoint: r.functionPoint, testProject: r.testProject,
        domain: r.domain, designer: r.designer, manualMin: r.minutes, autoFlag: r.autoFlag, autoTool: r.autoTool,
        autoTime: r.autoTime, autoUpdatedAt: r.autoUpdatedAt, remark: r.remark,
        pre: r.pre, steps: r.steps, input: r.input, expect: r.expect,
        marketBug: r.marketBug, marketBugDate: r.marketBugDate
      });
      added++;
    });
    if (!added) { toast('所选用例已全部加入，无需重复添加'); return; }
    recomputeExecStats(e);
    log('添加用例', `${execId}｜执行人 ${to}｜新增 ${added} 条用例（由 ${DB.currentUser} 指定执行人）`, e.taskId);
    closeTopModal(); renderTaskExec(e.taskId); toast(`已为 ${to} 添加 ${added} 条用例`, 'success');
  };
};

/* 从过往执行记录导入：选择其他执行任务（含已完结 / 归档任务）的用例导入本执行任务 */
window.openImportFromExec = function (execId) {
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e) return;
  const people = executorsOf(e);
  if (!people.length) { toast('该执行任务未设置执行人，请先在「修改」中填写执行人'); return; }
  const rows = execCaseRows(e);
  const hist = DB.execTasks.filter(x => x.execId !== execId);
  modal(`从过往执行记录导入 · ${e.execId}`, `
    
    <table class="detail-table">
      <tr><td style="width:110px">执行人：</td><td><select id="ieTo">${people.map(x => `<option>${x}</option>`).join('')}</select>
        </td></tr>
      <tr><td>来源执行任务：</td><td><select id="ieTask">${hist.map(x => {
        const t = DB.tasks.find(tt => tt.id === x.taskId) || {};
        return `<option value="${x.execId}">${x.execId}｜${x.model}｜第 ${x.round} 轮｜${x.executors}｜${t.finished === '是' ? '已归档' : (x.finished === true ? '已结束' : '进行中')}</option>`;
      }).join('') || '<option value="">暂无其他执行任务</option>'}</select></td></tr>
    </table>
    <div class="table-wrap" style="max-height:42vh" id="ieList"></div>
    <div class="form-actions">
      <span class="hint" style="margin:0" id="ieTip"></span>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="ieOk">导入选中用例</button>
    </div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1180px, 94vw)';
  const draw = () => {
    const src = DB.execTasks.find(x => x.execId === $('#ieTask').value);
    const list = src ? execCaseRows(src) : [];
    const dup = list.filter(r => rows.some(x => x.summary === r.summary)).length;
    $('#ieTip').textContent = `共 ${list.length} 条，其中 ${dup} 条已在本执行任务中（导入时自动跳过）`;
    $('#ieList').innerHTML = list.length
      ? `<table><thead><tr><th style="width:44px">选择</th><th>用例编号</th><th>功能模块</th><th>用例概述</th><th>等级</th><th>执行结果</th><th>原执行人</th></tr></thead>
         <tbody>${list.map((r, i) => `<tr><td><input type="checkbox" class="iechk" data-i="${i}"></td>
           <td>${r.caseId}</td><td>${r.module || r.functionPoint || '—'}</td><td style="white-space:normal">${r.summary}</td>
           <td>${r.level || '—'}</td><td>${resultPill(r.result)}</td><td>${r.executor || '—'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">该执行任务暂无用例</div>';
  };
  $('#ieTask').onchange = draw;
  draw();
  $('#ieOk').onclick = () => {
    const to = $('#ieTo').value;
    const src = DB.execTasks.find(x => x.execId === $('#ieTask').value);
    if (!src) { toast('请选择来源执行任务'); return; }
    const picks = $$('.iechk:checked').map(c => +c.dataset.i);
    if (!picks.length) { toast('请勾选要导入的用例'); return; }
    const list = execCaseRows(src);
    let added = 0;
    picks.forEach(i => {
      const r = list[i];
      if (!r) return;
      if (rows.some(x => x.summary === r.summary)) return;
      rows.push({
        id: r.caseId, module: r.module, branch: r.branch, summary: r.summary, level: r.level,
        source: '过往执行记录', result: '', note: '', executor: to,
        testProject: r.testProject, functionPoint: r.functionPoint, testPoint: r.testPoint, testType: r.testType,
        pre: r.pre, steps: r.steps, input: r.input, expect: r.expect
      });
      added++;
    });
    if (!added) { toast('所选用例已全部在本执行任务中，无需重复导入'); return; }
    recomputeExecStats(e);
    log('从过往执行记录导入', `${e.execId}｜来源 ${src.execId}｜执行人 ${to}｜新增 ${added} 条`, e.taskId);
    closeAllModals(); renderTaskExec(e.taskId);
    toast(`已从 ${src.execId} 导入 ${added} 条用例给 ${to}`, 'success');
  };
};

window.viewExecCases = function (execId) {
  const e = DB.execTasks.find(x => x.execId === execId);
  modal('执行用例明细 · ' + execId, `
    <table class="detail-table"><thead><tr><th>用例编号</th><th>来源</th><th>功能点</th><th>用例概述</th><th>等级</th><th>执行人</th><th>执行结果</th></tr></thead>
    <tbody>${execCaseRows(e).map(r => `<tr><td>${r.caseId}</td><td>${r.source}</td><td>${r.functionPoint}</td><td style="white-space:normal">${r.summary}</td><td>${r.level || '—'}</td><td>${r.executor || '—'}</td><td>${resultPill(r.result)}</td></tr>`).join('')}</tbody></table>`);
};

window.openExec = function (execId) {
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e.items) { openExecCases(execId); return; }
  const rows = execCaseRows(e);
  modal('执行用例 · ' + e.execId + '（' + e.model + '）', `
    <div class="hint">用例来源：${e.caseSource || '产品用例库'}　共 ${rows.length} 条　执行人：${e.executors}</div>
    <div class="table-wrap" style="max-height:50vh;overflow:auto">
      <table><thead><tr><th>用例编号</th><th>来源</th><th>功能点</th><th>用例概述</th><th>等级</th><th>执行人</th><th>执行结果</th><th>执行结果备注信息</th></tr></thead>
      <tbody>${rows.map((r, idx) => `<tr>
        <td>${r.caseId}</td><td>${r.source}</td><td>${r.functionPoint}</td><td style="white-space:normal">${r.summary}</td><td>${r.level || '—'}</td>
        <td>${r.executor || '—'}</td>
        <td><select class="execres" data-idx="${idx}"><option value=""${!r.result ? ' selected' : ''}>（未选择）</option>${EXEC_RESULTS.map(o => `<option ${r.result === o ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
        <td><input class="execnote" data-idx="${idx}" value="${r.resultNote || ''}" style="width:120px"></td>
      </tr>`).join('')}</tbody></table>
    </div>
    <div class="form-actions">
      
      <span class="hint" style="margin:0">发散用例条数 <input id="diverged" type="number" value="${e.diverged || 0}" style="width:70px"></span>
      <span class="hint" style="margin:0" id="execSaveTip">内容变动即自动保存</span>
      <span class="chip chip-info" data-sync-badge>${syncBadgeText()}</span>
      <button class="btn btn-ghost" id="markAllPass">全部标记通过</button>
      <button class="btn btn-ghost" id="clearAll">清空结果</button>
      <button class="btn btn-primary" id="execDone">完成</button>
    </div>`);
  /* 弹窗内同样是「内容变动即自动保存」：下拉 change、备注输入停顿 600ms 后落库，
     「全部标记通过 / 清空结果 / 发散用例条数」也即时落库，不再需要「保存执行结果」按钮。 */
  const commitExecRow = (s, key) => {
    const r = rows[+s.dataset.idx];
    if (!r) return;
    if (String(r[key] == null ? '' : r[key]) === String(s.value)) return;
    r[key] = s.value;
    if (key === 'result') setResClass(s, s.value);
    recomputeExecStats(e);
    save();
    queueExecSync(e, r, key, s.value);
    flashExecSaved(e);
  };
  const applyAll = val => {
    let n = 0;
    $$('.execres').forEach(s => {
      const r = rows[+s.dataset.idx];
      if (s.disabled || !r || r.result === val) return;
      s.value = val; setResClass(s, val);
      r.result = val; queueExecSync(e, r, 'result', val); n++;
    });
    if (n) { recomputeExecStats(e); save(); flashExecSaved(e); }
    toast(n ? `已把 ${n} 条用例结果标记为 ${val}（已自动保存）` : `当前结果均已是 ${val}`, 'success');
  };
  $$('.execres').forEach(s => s.onchange = () => commitExecRow(s, 'result'));
  $$('.execnote').forEach(s => {
    let t = 0;
    s.oninput = () => { clearTimeout(t); t = setTimeout(() => commitExecRow(s, 'resultNote'), 600); };
    s.onblur = () => { clearTimeout(t); commitExecRow(s, 'resultNote'); };
  });
  $('#diverged').onchange = ev => {
    e.diverged = +ev.target.value || 0;
    save();
    log('修改发散用例条数', `${e.execId}｜发散用例 ${e.diverged} 条`, e.taskId);
  };
  $('#markAllPass').onclick = () => applyAll('Pass');
  $('#clearAll').onclick = () => applyAll('N/A');
  $('#execDone').onclick = () => { closeTopModal(); renderApp(); };
};

/* ---------- 执行任务详情 ---------- */
window.openExecDetail = function (execId) {
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e) return;
  const st = execStats(e), planned = execPlanned(e);
  const rows = execCaseRows(e);
  /* 执行人统计：产品用例库型任务按当前划分实时汇总；历史任务沿用其原始统计 */
  const statList = (e.execStats && e.execStats.length) ? e.execStats : (e.items ? recomputeExecStats(e) : []);
  let page = 1;
  const size = 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const info = [
    ['执行任务编号', e.execId], ['产品型号', e.model], ['领域', e.domain],
    ['测试轮数', e.round], ['硬件版本', e.hwVersion], ['固件版本', e.fwVersion],
    ['研发负责人', e.rdOwner || '—'], ['测试负责人', e.testOwner || e.executors], ['执行人', e.executors],
    ['预估投入工作量(h)', execManualMinutes(e)
      ? `${execEffortHours(e)}（按用例手动测试时间合计 ${execManualMinutes(e)} min 换算）`
      : (rows.length ? '—（用例均未填写手动测试时间）' : '—（暂无用例明细）')],
    ['任务产品', e.productName || '—'], ['是否完结', '否'], ['关联任务编号', e.taskId],
    ['关联任务平台编码', '—'], ['计划执行时间(h)', e.planTime || '—'], ['实际执行时间(h)', e.actualTime || '—']
  ];
  const statRows = [
    ['计划执行用例数', planned, '实际执行用例数', st.actual, '通过条数', st.passed],
    ['失败条数', st.failed, '阻塞条数', st.blocked, '未执行条数', st.notRun],
    ['通过率', rate(st.passed, planned), '失败率', rate(st.failed, planned), '阻塞率', rate(st.blocked, planned)],
    ['未执行率', rate(st.notRun, planned), '发散用例条数', e.diverged || 0, '自动化用例数', 0]
  ];
  let html = `
    <div class="infobar">
      <div><b>${e.name}</b>　产品型号：${e.model}　领域：${e.domain}　轮数：${e.round}</div>
      <div class="prog-lg"><span style="width:${rate(st.actual, planned)}"></span></div>
      <div class="hint" style="margin:0">执行进度：共 ${planned} 条，已执行 ${st.actual} 条　${rate(st.actual, planned)}</div>
    </div>
    <h4 class="sub-title">执行任务详情</h4>
    <table class="detail-table grid-4"><tbody>
      ${info.reduce((acc, cur, i) => {
    if (i % 2 !== 0) return acc;
    const nxt = info[i + 1];
    return acc + (nxt
      ? `<tr><td>${cur[0]}：</td><td>${cur[1]}</td><td>${nxt[0]}：</td><td>${nxt[1]}</td></tr>`
      : `<tr><td>${cur[0]}：</td><td>${cur[1]}</td><td></td><td></td></tr>`);
  }, '')}
    </tbody></table>
    <h4 class="sub-title">统计信息</h4>
    <table class="detail-table"><tbody>
      ${statRows.map(r => `<tr><td>${r[0]}：</td><td><b>${r[1]}</b></td><td>${r[2]}：</td><td><b>${r[3]}</b></td><td>${r[4]}：</td><td><b>${r[5]}</b></td></tr>`).join('')}
    </tbody></table>
    <h4 class="sub-title">执行人统计 <span class="chip">多执行人时按执行人分别汇总</span></h4>
    <div class="table-wrap" style="max-height:26vh">
      <table><thead><tr><th>执行人</th><th>计划执行用例数</th><th>实际执行用例数</th><th>通过条数</th><th>失败条数</th><th>阻塞条数</th><th>未执行条数</th><th>发散用例条数</th></tr></thead>
      <tbody>${statList.map(s => `<tr>
        <td>${s.name || '—'}</td><td>${s.planned || 0}</td><td>${s.actual || 0}</td><td>${s.passed || 0}</td>
        <td>${s.failed || 0}</td><td>${s.blocked || 0}</td><td>${s.notRun || 0}</td><td>${s.diverged || 0}</td></tr>`).join('')}</tbody></table>
    </div>
    <h4 class="sub-title">用例执行明细 <span class="chip">共 ${rows.length} 条${rows.length < planned ? '（样例）' : ''} · 共 ${totalPages} 页</span>
      <button class="btn btn-ghost btn-sm" onclick="openColPicker('detail')">筛选列</button></h4>
    <div class="table-wrap" id="detailList" style="max-height:44vh"></div>
    <div class="pickbar" style="margin:10px 0 0">
      <span>每页显示 <input id="dtSize" type="number" value="${size}" style="width:56px" disabled> 条</span>
      <span id="dtPager"></span>
    </div>`;
  modal('执行任务详情 · ' + e.execId, html);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1560px, 96vw)';

  const drawList = () => {
    const list = rows.slice((page - 1) * size, page * size)
      .map((r, i) => Object.assign({}, r, { __seq: (page - 1) * size + i + 1 }));
    $('#detailList').innerHTML = tableByCols('detail', list);
    $('#dtPager').innerHTML = `<button class="btn btn-ghost btn-sm" id="dtPrev" ${page === 1 ? 'disabled' : ''}>上一页</button>
      <em style="margin:0 8px">${page} / ${totalPages}</em>
      <button class="btn btn-ghost btn-sm" id="dtNext" ${page === totalPages ? 'disabled' : ''}>下一页</button>`;
    window.__detailRedraw = drawList;
    $('#dtPrev').onclick = () => { if (page > 1) { page--; drawList(); } };
    $('#dtNext').onclick = () => { if (page < totalPages) { page++; drawList(); } };
  };
  drawList();
};

/* 执行结果配色（下拉框着色） */
function resultClass(v) {
  if (v === 'Pass') return ' res-pass';
  if (v === 'Fail') return ' res-fail';
  if (v === '阻塞') return ' res-block';
  if (v === '未执行') return ' res-notrun';
  return ' res-na';
}
function resultPill(v) {
  /* 空 = 尚未选择执行结果（与「N/A 不适用」区分开，不再把空当成 N/A 展示） */
  if (!v) return '<span class="hint" style="margin:0;color:#8a9aab">未选择</span>';
  if (v === 'N/A') return '<span class="pill pill-gray">N/A</span>';
  if (v === 'Pass' || v === '通过') return '<span class="pill pill-success">Pass</span>';
  if (v === 'Fail' || v === '失败') return '<span class="pill pill-danger">Fail</span>';
  if (v === '阻塞' || v === 'Block') return '<span class="pill pill-warn">阻塞</span>';
  return `<span class="pill pill-gray">${v}</span>`;
}
const RES_CLASSES = ['res-pass', 'res-fail', 'res-block', 'res-na', 'res-notrun'];
/* 只改「执行结果」的配色类，必须保留 ssel-native 等下拉增强层的类 —— 早期写法用
   className 整体覆盖，会把 ssel-native 一起抹掉，原生 select 就会重新显形并与增强显示层
   同时出现，用户看到的就是「一列里有两个执行结果」。 */
function setResClass(sel, v) {
  if (!sel || !sel.classList) return;
  RES_CLASSES.forEach(c => sel.classList.remove(c));
  String(resultClass(v)).trim().split(/\s+/).filter(Boolean).forEach(c => sel.classList.add(c));
}

/* ---------- 用例执行页（全部执行任务） ---------- */
const EXEC_RESULTS = ['N/A', 'Pass', 'Fail', '阻塞', '未执行'];
window.openExecCases = function (execId, scope) {
  state.execCase = { execId, page: 1, size: 20, filters: {}, scope: scope || 'all', sortBy: 'default' };
  renderExecCases();
  saveView();
};
/* 执行任务用例行：统一为可编辑的行对象，并与 items 共用同一引用，保证编辑（结果/执行人）真正持久化 */
function execCaseRows(e) {
  if (!e.rows) e.rows = (e.execRows && e.execRows.length) ? e.execRows : (e.items || []);
  const people = executorsOf(e);
  /* 来源用例解析：模块用例走全库索引（O(1)），产品用例行按需构建一次索引（避免逐行全量重算） */
  const srcProduct = DB.products.find(x => x.model === e.model);
  let prodRowMap = null;
  const ensureProdRowMap = () => {
    if (!prodRowMap && srcProduct) prodRowMap = new Map(prodCaseRows(srcProduct).map(x => [x.id, x]));
    return prodRowMap;
  };
  const sourceOf = cid => {
    const c = String(cid || '');
    const prefix = String(e.model || '') + '-';
    const srcId = c.indexOf(prefix) === 0 ? c.slice(prefix.length) : c;
    const sc = stdCaseById(srcId);
    if (sc) return sc;
    const m = ensureProdRowMap();
    return m ? (m.get(c) || null) : null;
  };
  e.rows.forEach((r, idx) => {
    if (r.seq == null) r.seq = idx + 1;
    if (r.caseId == null) r.caseId = r.id || '';
    /* 执行结果保持「未选择 = 空字符串」：不再自动填 N/A，避免用户没选结果也被当成 N/A */
    if (r.result == null) r.result = '';
    if (r.resultNote == null) r.resultNote = r.note || '';
    if (r.auto == null) r.auto = '否';
    if (r.actualTime == null) r.actualTime = '';
    if (r.testProject == null) r.testProject = '';
    if (r.functionPoint == null) r.functionPoint = r.module || '';
    if (r.testPoint == null) r.testPoint = '';
    if (r.summary == null) r.summary = '';
    if (r.pre == null) r.pre = '';
    if (r.steps == null) r.steps = '';
    if (r.input == null) r.input = '';
    if (r.expect == null) r.expect = '';
    if (!r.source) r.source = '产品用例库';
    /* 执行人由「添加用例」时指定，未指定的保持未分配，等待责任人或任务维护人指派 */
    if (!r.executor) r.executor = '未分配';
    /* 从来源用例补全展示字段：
       ① 分析维度（测试类型 / 功能点 / 测试点）供执行页筛选树归类；
       ② 用例内容字段（测试项目 / 领域 / 等级 / 分支 / 设计者 / 手动测试时间 / 自动化信息 / 备注 / 市场反馈）
          供执行明细与「用例详情」展示，使执行侧与用例库字段一致 */
    const needFill = !r.testType || !r.testPoint || !r.functionPoint || r.functionPoint === r.module ||
      !r.testProject || !r.designer || !r.domain || !r.level || !r.branch ||
      !r.pre || !r.steps || !r.input || !r.expect ||
      r.manualMin == null || r.autoFlag == null || r.remark == null || !r.source || r.source === '产品用例库';
    if (needFill) {
      const sc = sourceOf(r.caseId);
      if (sc) {
        if (!r.testType) r.testType = sc.testType || '';
        if (!r.functionPoint || r.functionPoint === r.module) r.functionPoint = sc.functionPoint || r.functionPoint;
        if (!r.testPoint) r.testPoint = sc.testPoint || '';
        if (!r.testProject) r.testProject = sc.testProject || r.module || '';
        if (!r.domain) r.domain = sc.domain || '';
        if (!r.level) r.level = sc.level || '';
        if (!r.branch) r.branch = sc.branch || '';
        else r.branch = normBranch(r.branch);
        if (!r.designer) r.designer = sc.designer || '';
        if (r.manualMin == null || r.manualMin === '') {
          r.manualMin = (sc.minutes == null || sc.minutes === '' || sc.minutes === '—') ? '' : sc.minutes;
        }
        if (r.autoFlag == null) r.autoFlag = sc.autoFlag || '否';
        if (r.autoTool == null) r.autoTool = sc.autoTool || '—';
        if (r.autoTime == null) r.autoTime = sc.autoTime || '—';
        if (r.autoUpdatedAt == null) r.autoUpdatedAt = sc.autoUpdatedAt || '—';
        if (r.remark == null || r.remark === '') r.remark = sc.remark || '';
        /* 用例内容字段：前置条件 / 操作步骤 / 输入数据 / 预期结果同样按来源用例补全——
           否则「添加用例」「沿用上一轮」带入的行在执行明细里这几列会显示为空 */
        if (r.pre == null || r.pre === '') r.pre = sc.pre || '';
        if (r.steps == null || r.steps === '') r.steps = sc.steps || '';
        if (r.input == null || r.input === '') r.input = sc.input || '';
        if (r.expect == null || r.expect === '') r.expect = sc.expect || '';
        if (r.marketBug == null) r.marketBug = sc.marketBug || '';
        if (r.marketBugDate == null) r.marketBugDate = sc.marketBugDate || '';
        if (!r.source || r.source === '产品用例库') r.source = sc.source || '引用模块库';
      }
    }
  });
  return e.rows;
}
/* 执行任务下的执行人清单（含历史遗留 / 未分配，保证每个执行人都能对上自己的用例） */
function executorScopes(e) {
  const list = executorsOf(e);
  execCaseRows(e).forEach(r => { if (r.executor && !list.includes(r.executor)) list.push(r.executor); });
  return list;
}
/* ---------- 用例执行页：左侧筛选树（逻辑与产品用例库的齐全度分析树一致）
   执行任务本身已限定产品型号，因此层级不含「产品线 / 产品型号」，仅保留：
   领域 / 测试类型 / 功能模块 / 功能点 / 测试点（可自定义启用与顺序） ---------- */
const EXEC_TREE_LEVELS = [
  { key: 'domain', label: '领域' },
  { key: 'testType', label: '测试类型' },
  { key: 'module', label: '功能模块' },
  { key: 'functionPoint', label: '功能点' },
  { key: 'testPoint', label: '测试点' }
];
const EXEC_TREE_DEFAULT = ['domain', 'testType', 'module', 'functionPoint', 'testPoint'];
function execTreeLevelDefs() {
  return state.execTreeLevels.map(k => EXEC_TREE_LEVELS.find(l => l.key === k)).filter(Boolean);
}
function execTreeLevelLabel(key) {
  const d = EXEC_TREE_LEVELS.find(l => l.key === key);
  return d ? d.label : key;
}
/* 层级取值：领域优先取用例自身填写值（执行行由来源用例补全），缺失时按功能模块领域回退 */
function execTreeValue(row, level) {
  if (level === 'domain') return row.domain || moduleDomainOf(row.module, '—');
  const v = row[level];
  return v == null || v === '' ? '—' : String(v);
}
function buildExecTree(rows) {
  const levels = execTreeLevelDefs().map(l => l.key);
  const root = { children: new Map(), count: 0, path: [] };
  rows.forEach(r => {
    let node = root;
    node.count++;
    levels.forEach(lv => {
      const v = execTreeValue(r, lv);
      if (!node.children.has(v)) node.children.set(v, { value: v, children: new Map(), count: 0, path: node.path.concat([{ level: lv, value: v }]) });
      node = node.children.get(v);
      node.count++;
    });
  });
  return root;
}
function execTreeFiltered(rows) {
  const keys = Object.keys(state.execTreePath);
  if (!keys.length) return rows;
  return rows.filter(r => keys.every(k => execTreeValue(r, k) === String(state.execTreePath[k])));
}
function execTreeNodeActive(path) {
  return path.every(x => String(state.execTreePath[x.level]) === String(x.value));
}
function execTreePanel(allRows, shownRows) {
  const kw = (state.execTreeKw || '').trim().toLowerCase();
  const tree = buildExecTree(allRows);
  if (kw) pruneProdTree(tree, kw);
  const out = [];
  const walk = (node, depth) => {
    Array.from(node.children.values()).forEach(child => {
      const key = prodTreeKey(child.path);
      const hasKids = child.children.size > 0;
      const collapsed = kw ? false : (state.execTreeCollapseAll ? depth > 0 : !!state.execTreeCollapsed[key]);
      const active = execTreeNodeActive(child.path);
      out.push(`<div class="tree-node${active ? ' active' : ''}" data-enode="${key}" style="padding-left:${6 + depth * 13}px">
        <span class="tn-toggle" data-etoggle="${key}">${hasKids ? (collapsed ? '▸' : '▾') : '·'}</span>
        <span class="tn-label" data-epick="${key}">${child.value}</span>
        <em>${child.count}</em></div>`);
      if (hasKids && !collapsed) walk(child, depth + 1);
    });
  };
  walk(tree, 0);
  const pathKeys = Object.keys(state.execTreePath);
  const crumb = pathKeys.length
    ? pathKeys.map(k => `${execTreeLevelLabel(k)}：${state.execTreePath[k]}`).join('　›　')
    : '全部用例';
  const levels = execTreeLevelDefs();
  return `
    <h4>用例筛选树</h4>
    <div class="prod-tree-tools">
      <span class="link" onclick="expandExecTree(true)">展开全部</span>
      <span class="link" onclick="expandExecTree(false)">收起全部</span>
      <span class="link" onclick="openExecTreeLevels()">层级设置</span>
      <span class="link" onclick="clearExecTree()">清除筛选</span>
    </div>
    <div class="prod-tree-levels">层级：${levels.map(l => l.label).join(' › ')}</div>
    <div class="prod-tree-crumb">筛选：<b>${crumb}</b>　<span class="chip">${shownRows.length} / ${allRows.length} 条</span></div>
    <input id="execTreeKw" placeholder="搜索功能模块 / 节点名称" value="${state.execTreeKw}">
    <div class="tree-list">${out.join('') || `<div class="empty" style="padding:12px">${kw ? '没有匹配的节点' : '该执行任务暂无用例'}</div>`}</div>`;
}
function bindExecTree() {
  $$('[data-etoggle]').forEach(el => el.onclick = (ev) => {
    ev.stopPropagation();
    const key = el.dataset.etoggle;
    if (state.execTreeCollapseAll) state.execTreeCollapseAll = false;
    if (state.execTreeCollapsed[key]) delete state.execTreeCollapsed[key];
    else state.execTreeCollapsed[key] = true;
    renderExecCases();
  });
  $$('[data-epick]').forEach(el => el.onclick = () => {
    const path = prodTreeDecode(el.dataset.epick);
    const last = path[path.length - 1];
    if (execTreeNodeActive(path) && String(state.execTreePath[last.level]) === String(last.value)) {
      /* 再次点击同一节点 = 取消该级筛选（回到父级） */
      state.execTreePath = {};
      path.slice(0, -1).forEach(x => { state.execTreePath[x.level] = x.value; });
    } else {
      state.execTreePath = {};
      path.forEach(x => { state.execTreePath[x.level] = x.value; });
    }
    state.execCase.page = 1;
    renderExecCases();
  });
  const kwEl = $('#execTreeKw');
  if (kwEl) kwEl.oninput = () => {
    state.execTreeKw = kwEl.value;
    renderExecCases();
    const el = $('#execTreeKw');
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  };
}
window.clearExecTree = function () {
  /* 清除筛选同时清空节点搜索词，避免树因残留关键字而显示为空 */
  state.execTreePath = {};
  state.execTreeKw = '';
  state.execCase.page = 1;
  renderExecCases();
};
window.expandExecTree = function (expand) {
  if (expand) {
    state.execTreeCollapsed = {};
    state.execTreeCollapseAll = false;
  } else {
    /* 收起时保留第一层，其余折叠 */
    const e = DB.execTasks.find(x => x.execId === state.execCase.execId);
    const tree = buildExecTree(e ? execCaseRows(e) : []);
    const next = {};
    const walk = node => Array.from(node.children.values()).forEach(c => { if (c.children.size) { next[prodTreeKey(c.path)] = true; walk(c); } });
    walk(tree);
    Array.from(tree.children.values()).forEach(c => { delete next[prodTreeKey(c.path)]; });
    state.execTreeCollapsed = next;
    state.execTreeCollapseAll = false;
  }
  renderExecCases();
};
/* 筛选树层级自定义：勾选启用 + 上移 / 下移调整顺序（顺序即树的上下级层级） */
window.openExecTreeLevels = function () {
  let order = EXEC_TREE_LEVELS.map(l => l.key).filter(k => state.execTreeLevels.indexOf(k) >= 0)
    .concat(EXEC_TREE_LEVELS.map(l => l.key).filter(k => state.execTreeLevels.indexOf(k) < 0));
  const enabled = new Set(state.execTreeLevels);
  const labelOf = k => (EXEC_TREE_LEVELS.find(l => l.key === k) || { label: k }).label;
  const draw = () => {
    $('#etlList').innerHTML = order.map((k, i) => `
      <tr class="${enabled.has(k) ? '' : 'tl-off'}">
        <td style="width:44px"><input type="checkbox" class="etlchk" value="${k}" ${enabled.has(k) ? 'checked' : ''}></td>
        <td style="width:44px;color:#8a9aab">${i + 1}</td>
        <td><b>${labelOf(k)}</b></td>
        <td style="width:150px">
          <button class="btn btn-ghost btn-sm" data-eup="${k}" ${i === 0 ? 'disabled' : ''}>上移</button>
          <button class="btn btn-ghost btn-sm" data-edown="${k}" ${i === order.length - 1 ? 'disabled' : ''}>下移</button>
        </td>
      </tr>`).join('');
    $$('.etlchk').forEach(c => c.onchange = () => { if (c.checked) enabled.add(c.value); else enabled.delete(c.value); });
    $$('[data-eup]').forEach(b => b.onclick = () => {
      const i = order.indexOf(b.dataset.eup);
      if (i > 0) { const t = order[i - 1]; order[i - 1] = order[i]; order[i] = t; draw(); }
    });
    $$('[data-edown]').forEach(b => b.onclick = () => {
      const i = order.indexOf(b.dataset.edown);
      if (i >= 0 && i < order.length - 1) { const t = order[i + 1]; order[i + 1] = order[i]; order[i] = t; draw(); }
    });
  };
  modal('执行页筛选树层级设置', `
    
    <div class="table-wrap"><table><thead><tr><th>启用</th><th>顺序</th><th>层级</th><th>调整</th></tr></thead><tbody id="etlList"></tbody></table></div>
    <div class="form-actions">
      <button class="btn btn-ghost" id="etlDefault">恢复默认</button>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="etlSave">确定</button>
    </div>`);
  draw();
  $('#etlDefault').onclick = () => {
    enabled.clear();
    EXEC_TREE_DEFAULT.forEach(k => enabled.add(k));
    order = EXEC_TREE_DEFAULT.concat(EXEC_TREE_LEVELS.map(l => l.key).filter(k => EXEC_TREE_DEFAULT.indexOf(k) < 0));
    draw();
  };
  $('#etlSave').onclick = () => {
    const keys = order.filter(k => enabled.has(k));
    if (!keys.length) { toast('请至少选择一个层级'); return; }
    state.execTreeLevels = keys;
    Object.keys(state.execTreePath).forEach(k => { if (keys.indexOf(k) < 0) delete state.execTreePath[k]; });
    closeTopModal(); renderExecCases();
    toast(`筛选树层级已更新（${keys.map(labelOf).join(' › ')}）`, 'success');
  };
};

function renderExecCases() {
  const st = state.execCase;
  const e = DB.execTasks.find(x => x.execId === st.execId);
  if (!e) { renderApp(); return; }
  /* 记住当前执行任务：刷新后仍停留在该执行明细页 */
  saveView();
  const all = execCaseRows(e);
  const executors = executorScopes(e);
  const scope = st.scope || 'all';
  const scoped = scope === 'all' ? all : all.filter(r => r.executor === scope);
  const perPerson = executors.map(p => {
    const s = (e.execStats || []).find(x => x.name === p) || countRows(all.filter(r => r.executor === p));
    return { name: p, planned: s.planned || 0, actual: s.actual || 0, passed: s.passed || 0, failed: s.failed || 0, blocked: s.blocked || 0, notRun: s.notRun || 0 };
  });
  const f = st.filters;
  /* 左侧筛选树先按层级路径过滤，再叠加字段筛选条件 */
  let rows = execTreeFiltered(scoped).filter(r =>
    (!f.result || (f.result === '__none' ? !r.result : (r.result || '') === f.result)) &&
    (!f.functionPoint || (r.functionPoint || '').includes(f.functionPoint)) &&
    (!f.summary || (r.summary || '').includes(f.summary)) &&
    (!f.pre || (r.pre || '').includes(f.pre)) &&
    (!f.steps || (r.steps || '').includes(f.steps)) &&
    (!f.input || (r.input || '').includes(f.input)) &&
    (!f.expect || (r.expect || '').includes(f.expect)));
  /* 排序：默认导入顺序 / 按功能模块（功能点）分组 / 按用例编号 / 未执行优先 */
  const sortBy = st.sortBy || 'default';
  if (sortBy === 'functionPoint') rows = rows.slice().sort((a, b) => String(a.functionPoint || '').localeCompare(String(b.functionPoint || '')) || String(a.caseId).localeCompare(String(b.caseId)));
  else if (sortBy === 'caseId') rows = rows.slice().sort((a, b) => String(a.caseId).localeCompare(String(b.caseId)));
  else if (sortBy === 'pending') rows = rows.slice().sort((a, b) => {
    const rank = r => (!r.result || r.result === 'N/A' || r.result === '未执行') ? 0 : 1;
    return rank(a) - rank(b) || String(a.caseId).localeCompare(String(b.caseId));
  });
  const pages = Math.max(1, Math.ceil(rows.length / st.size));
  st.page = Math.min(st.page, pages);
  const list = rows.slice((st.page - 1) * st.size, st.page * st.size);
  const sst = scopeStats(e, scope);
  const plannedAll = sst.planned || scoped.length;
  const doneAll = sst.actual || 0;
  const pct = plannedAll ? Math.round(doneAll * 100 / plannedAll) : 0;
  /* 行级权限：执行人只能操作划分到自己名下的用例，其他人员名下仅可查看 */
  const role = execRoleOf(e);
  const lockedAll = all.filter(r => execRowLocked(r, e)).length;
  const myRows = all.filter(r => String(r.executor || '') === role.me).length;

  $('#page').innerHTML = `
    <div class="flex">
    <aside class="sidebar">
      ${execTreePanel(scoped, rows)}
    </aside>
    <div class="main">
    <div class="infobar">
      <button class="btn btn-ghost btn-sm" onclick="renderTaskExec('${e.taskId}')">← 返回任务</button>
      <div>任务：<b>${(DB.tasks.find(t => t.id === e.taskId) || {}).name || e.taskId}</b>　产品型号：${e.model}　当前执行人：<b>${scope === 'all' ? '全部执行人' : scope}</b>　数据范围：${scope === 'all' ? '全部执行人负责的用例' : `${scope} 负责的用例`}</div>
      <div class="prog-lg" id="execProgBar"><span style="width:${pct}%"></span></div>
      <div class="hint" style="margin:0">执行进度：共：<b id="execPlanned">${plannedAll}</b>条，已执行：<b id="execDone">${doneAll}</b>条　<b id="execPct">${pct}</b>%　<span class="chip">当前展示样例 ${all.length} 条</span>${executors.length > 1 ? `<span class="chip chip-warn">多执行人任务，已按执行人划分</span>` : ''}${e.finished ? `<span class="chip chip-danger">已结束（只读）</span>` : ''}</div>
    </div>
    ${e.finished ? `<div class="hint" style="background:#fdf3e2;border-radius:8px;padding:10px 14px">
      该执行任务已于 ${e.finishedAt || '—'} 结束，本轮执行记录已封存。</div>`
      : `<div class="hint" style="background:#f1f8f7;border-radius:8px;padding:10px 14px">
      当前登录账号：<b>${role.me}</b>（${role.isExecutor ? `本任务执行人${role.isManager ? '，兼具任务管理权限' : ''}` : role.isManager ? '任务管理角色（可代操作）' : '非本任务执行人'}）　
      可操作用例 <b>${all.length - lockedAll}</b> 条${role.isExecutor ? `（本人名下 ${myRows} 条）` : ''}，仅可查看 <b>${lockedAll}</b> 条　
      </div>`}
    ${(executors.length > 1) ? `
    <div class="scopebar">
      <span class="scope-label">执行人范围：</span>
      <span class="scope-chip ${scope === 'all' ? 'active' : ''}" data-scope="all" onclick="setExecScope('all')">全部执行人 <em>${doneAll}/${plannedAll}</em></span>
      ${perPerson.map(p => `<span class="scope-chip ${scope === p.name ? 'active' : ''}" data-scope="${p.name}" onclick="setExecScope('${p.name}')">${p.name} <em>${p.actual}/${p.planned}</em></span>`).join('')}
      <span class="scope-label" style="margin-left:auto">该执行任务按执行人划分：${executors.length} 人</span>
      <button class="btn btn-ghost btn-sm" onclick="openDivideExec()">调整执行人分配</button>
    </div>` : ''}
    <div class="toolbar">
      <div><label>执行结果</label><select id="ef_result"><option value="">请选择</option>
        <option value="__none" ${state.execCase.filters.result === '__none' ? 'selected' : ''}>（未选择）</option>
        ${EXEC_RESULTS.map(r => `<option ${state.execCase.filters.result === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label>功能点</label><input id="ef_func" value="${f.functionPoint || ''}"></div>
      <div><label>用例概述</label><input id="ef_summary" value="${f.summary || ''}"></div>
      <div><label>前置条件</label><input id="ef_pre" value="${f.pre || ''}"></div>
      <div><label>详细步骤</label><input id="ef_steps" value="${f.steps || ''}"></div>
      <div><label>输入数据</label><input id="ef_input" value="${f.input || ''}"></div>
      <div><label>预期结果</label><input id="ef_expect" value="${f.expect || ''}"></div>
      <div><label>排序</label><select id="ef_sort">
        <option value="default" ${sortBy === 'default' ? 'selected' : ''}>导入顺序</option>
        <option value="functionPoint" ${sortBy === 'functionPoint' ? 'selected' : ''}>按功能点分组</option>
        <option value="caseId" ${sortBy === 'caseId' ? 'selected' : ''}>按用例编号</option>
        <option value="pending" ${sortBy === 'pending' ? 'selected' : ''}>未执行优先</option>
      </select></div>
      <button class="btn btn-primary" id="ef_search">搜索</button>
      <button class="btn btn-ghost" id="ef_reset">重置</button>
      <button class="btn btn-ghost" onclick="openColPicker('exec')">筛选列</button>
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="actions">
          ${e.finished
            ? `${isLv1OrAbove() ? `<button class="btn btn-ghost" onclick="reopenExec('${e.execId}')">重新开启该执行任务</button>` : ''}
               <span class="chip chip-warn">已结束：只读</span>`
            : `<button class="btn btn-primary" onclick="batchPass()">批量 pass</button>
               <button class="btn btn-ghost" onclick="submitBug()">提交 Bug</button>
               <button class="btn btn-ghost" onclick="transferCases()">移交用例</button>
               <button class="btn btn-ghost" onclick="addCaseInExec()">新增用例</button>
               ${role.isManager ? `<button class="btn btn-ghost" onclick="openDivideExec()">调整执行人分配</button>
               <button class="btn btn-danger" onclick="endExecTask()">结束执行任务</button>` : ''}`}
        </div>
        <div class="actions">
          <span class="chip">已选 <b id="ecSelected">0</b> 条</span>
          <span class="chip chip-info" data-sync-badge title="执行结果的保存与同步状态（离线时先缓存到本机，恢复连接后自动同步）">${syncBadgeText()}</span>
          ${e.finished
            ? '<span class="hint" style="margin:0">已结束：记录封存，不可修改</span>'
            : '<span class="hint" style="margin:0" id="ecSaveTip">内容变动即自动保存（无需手动提交）</span>'}
        </div>
      </div>
      <div class="table-wrap" id="ecTableWrap">
        ${tableByCols('exec', list.map(r => Object.assign({ __idx: all.indexOf(r), __lock: execRowLocked(r, e) }, r)), {
      leadHead: `<th style="width:40px"><input type="checkbox" id="ecAll"></th>`,
      leadCell: r => `<td><input type="checkbox" class="ecchk" data-idx="${r.__idx}"${r.__lock ? ' disabled title="仅可查看：该用例不归你执行"' : ''}></td>`,
      rowClass: r => (r.__lock ? 'row-locked' : '')
    })}
      </div>
      ${pager(rows.length, st.page, pages)}
    </div>
    </div>
    </div>`;

  $('#ef_search').onclick = () => {
    st.filters = {
      result: $('#ef_result').value, functionPoint: $('#ef_func').value.trim(),
      summary: $('#ef_summary').value.trim(), pre: $('#ef_pre').value.trim(), steps: $('#ef_steps').value.trim(),
      input: $('#ef_input').value.trim(), expect: $('#ef_expect').value.trim()
    };
    st.sortBy = $('#ef_sort').value;
    st.page = 1; renderExecCases();
  };
  $('#ef_sort').onchange = e3 => { st.sortBy = e3.target.value; st.page = 1; renderExecCases(); };
  $('#ef_reset').onclick = () => { st.filters = {}; st.page = 1; renderExecCases(); };
  const syncSel = () => { $('#ecSelected').textContent = $$('.ecchk:checked').filter(c => !c.disabled).length; };
  /* 全选仅作用于可操作（本人名下）的用例，他人名下用例不可勾选 */
  $('#ecAll').onchange = e2 => { $$('.ecchk').forEach(c => { if (!c.disabled) c.checked = e2.target.checked; }); syncSel(); };
  $$('.ecchk').forEach(c => c.onchange = syncSel);
  /* ---------- 内容变动即自动保存（已取消「保存执行结果」按钮） ----------
     执行结果 / 是否自动化测试：change 立即落库；
     执行结果备注信息 / 实际测试时间：输入停顿 600ms 或失焦时落库，避免每敲一个字都整库写盘。
     落库 = 写 DB 行对象 + 重算执行统计 + 写 localStorage + 进入离线待同步队列（联网后自动上传）。 */
  const commitExec = (s, key) => {
    if (!s || s.disabled || e.finished) return;      /* 只读行 / 已结束任务不允许改写 */
    const r = all[+s.dataset.idx];
    if (!r) return;
    const v = s.value;
    const from = r[key] == null ? '' : r[key];
    if (String(from) === String(v)) return;
    r[key] = v;
    if (key === 'result') setResClass(s, v);
    recomputeExecStats(e);
    save();
    syncExecProgress(e, all);
    queueExecSync(e, r, key, v);
    /* 字段级留痕：谁在哪个执行任务、哪条用例上把哪个字段从什么改成什么（高频修改自动合并） */
    logExecField(e, r, key, from, v);
    flashExecSaved(e);
  };
  $$('#ecTableWrap .ecres').forEach(s => s.onchange = () => commitExec(s, 'result'));
  $$('#ecTableWrap .ecauto').forEach(s => s.onchange = () => commitExec(s, 'auto'));
  const commitLater = (s, key) => {
    let t = 0;
    s.oninput = () => { clearTimeout(t); t = setTimeout(() => commitExec(s, key), 600); };
    s.onblur = () => { clearTimeout(t); commitExec(s, key); };
  };
  $$('#ecTableWrap .ecnote').forEach(s => commitLater(s, 'resultNote'));
  $$('#ecTableWrap .ectime').forEach(s => commitLater(s, 'actualTime'));
  bindPager(p => { st.page = p; renderExecCases(); });
  /* 左侧筛选树交互 */
  bindExecTree();
  /* 执行页内的下拉框统一增强为关键字搜索下拉 */
  enhanceSelects(document);
  /* 执行明细表格列宽适配（列多且长文本多，必须定宽 + 截断才稳得住行高） */
  fitAllTables(document);
}
/* 自动保存后的轻量回显：只更新进度条 / 进度数字 / 执行人范围计数，不整页重绘（否则正在输入的内容会失焦） */
function syncExecProgress(e, all) {
  const scope = (state.execCase || {}).scope || 'all';
  const scoped = scope === 'all' ? all : all.filter(r => r.executor === scope);
  const sst = scopeStats(e, scope);
  const planned = sst.planned || scoped.length;
  const done = sst.actual || 0;
  const pct = planned ? Math.round(done * 100 / planned) : 0;
  const bar = $('#execProgBar > span');
  if (bar) bar.style.width = pct + '%';
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('execPlanned', planned);
  setTxt('execDone', done);
  setTxt('execPct', pct);
  $$('#page .scope-chip[data-scope]').forEach(chip => {
    const em = chip.querySelector('em');
    if (!em) return;
    const name = chip.dataset.scope;
    if (name === 'all') { em.textContent = done + '/' + planned; return; }
    const s = (e.execStats || []).find(x => x.name === name) || countRows(all.filter(r => r.executor === name));
    em.textContent = (s.actual || 0) + '/' + (s.planned || 0);
  });
}
/* 自动保存提示：在面板右上角闪一下「已保存 时间」，并把同步状态刷新给所有状态标签
   （日志不在这里写：字段级留痕由 logExecField / 批量操作各自记录，避免一次改动写两条） */
function flashExecSaved(e) {
  const tip = document.getElementById('ecSaveTip');
  if (tip) {
    tip.innerHTML = execSaveTipHtml();
    tip.classList.add('save-flash');
    setTimeout(() => { if (tip) tip.classList.remove('save-flash'); }, 600);
  }
  updateSyncBadges();
}
/* 执行明细字段改动留痕：`执行任务｜用例编号｜字段「原值」→「现值」`
   同一人 + 同一执行任务 + 同一用例 + 同一字段在合并窗口内连续修改合并为一条（count 记次数） */
function logExecField(e, r, key, from, to) {
  const field = EXEC_FIELD_LABELS[key] || key;
  const changes = [{ field, from: from === '' ? '（空）' : String(from), to: to === '' ? '（空）' : String(to) }];
  log('修改执行明细', `${e.execId}｜${r.caseId}｜${changesText(changes, 40)}`, e.taskId, {
    module: '执行', objType: '执行明细', objId: r.caseId, changes, max: 40,
    mergePrefix: `${e.execId}｜${r.caseId}｜`,
    mergeKey: `exec|${e.execId}|${r.caseId}|${key}|${DB.currentUser}`
  });
}
/* ================= 执行结果的离线缓存与服务端自动同步 =================
   离线优先：执行结果的每次变动都先落本机 localStorage（顺便进「待同步队列」），
   平台断网 / 服务端不可达时业务照常进行；连接恢复（online 事件、或每 30s 轮询重试）后
   自动把队列上传到服务端，成功即出队。
   同步接口通过 SYNC_ENDPOINT 配置（可在「保存与同步」面板里改，存 localStorage['tmplatform.syncEndpoint']）：
     POST <endpoint>  body { user, clientTime, changes:[ {execId, taskId, caseId, field, value, at} ] }
     返回 2xx 即视为同步成功；未配置接口时只做本机离线缓存，不做服务端上传。 */
const SYNC_KEY = 'tmplatform.pendingSync';
const SYNC_ENDPOINT_KEY = 'tmplatform.syncEndpoint';
function syncEndpoint() {
  try { return String(localStorage.getItem(SYNC_ENDPOINT_KEY) || '').trim(); } catch (e) { return ''; }
}
function pendingSyncList() {
  try { const a = JSON.parse(localStorage.getItem(SYNC_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function savePendingSync(list) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(list)); } catch (e) { } }
function pendingSyncCount() { return pendingSyncList().length; }
/* 状态标签文案：本机保存 → 已同步 / 待同步 N 条 / 离线缓存 N 条 */
function syncBadgeText() {
  const n = pendingSyncCount();
  if (!syncEndpoint()) return n ? `本机保存（${n} 条待接入服务端）` : '本机保存';
  if (!n) return '已同步';
  return (navigator.onLine === false ? '离线缓存 ' : '待同步 ') + n + ' 条';
}
function updateSyncBadges() {
  const t = syncBadgeText();
  $$('[data-sync-badge]').forEach(el => { el.textContent = t; });
}
/* 自动保存提示文案（含离线缓存条数） */
function execSaveTipHtml() {
  const n = pendingSyncCount();
  const tail = (!syncEndpoint() || !n) ? '' : `　<span class="chip chip-warn">离线缓存 ${n} 条待同步</span>`;
  return `已自动保存 <b>${nowStr().slice(11)}</b>${tail}`;
}
/* 变更入队：同一用例同一字段的连续修改只保留最后一次，避免队列膨胀 */
function queueExecSync(e, r, field, value) {
  const list = pendingSyncList();
  const key = e.execId + '|' + r.caseId + '|' + field;
  const item = { key, at: nowStr(), execId: e.execId, taskId: e.taskId || '', caseId: r.caseId, field, value, user: DB.currentUser };
  const i = list.findIndex(x => x.key === key);
  if (i >= 0) list[i] = item; else list.push(item);
  savePendingSync(list);
  updateSyncBadges();
  /* 联网且已配置接口时尽快尝试上传；批量动作（批量 pass / 全部标记通过）会连续入队，
     这里做 300ms 合并，最后一次性带着完整批次上传，避免连发多次请求 */
  scheduleSyncFlush();
}
let __syncFlushTimer = 0;
function scheduleSyncFlush() {
  if (__syncFlushTimer) return;
  __syncFlushTimer = setTimeout(() => { __syncFlushTimer = 0; flushPendingSync(true); }, 300);
}
let __syncBusy = false;
async function flushPendingSync(silent) {
  const ep = syncEndpoint();
  const list = pendingSyncList();
  if (!ep || !list.length || __syncBusy) { updateSyncBadges(); return false; }
  if (navigator.onLine === false) {
    updateSyncBadges();
    if (!silent) toast(`当前无网络，${list.length} 条执行结果已离线缓存，网络恢复后自动同步`);
    return false;
  }
  __syncBusy = true;
  try {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : 0;
    const resp = await fetch(ep, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: DB.currentUser, clientTime: nowStr(), changes: list }),
      signal: ctrl ? ctrl.signal : undefined
    });
    if (timer) clearTimeout(timer);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    /* 只移除本次成功上传的条目：上传期间新产生的变更留在队列里等下一轮 */
    const sent = list.map(x => x.key);
    savePendingSync(pendingSyncList().filter(x => sent.indexOf(x.key) < 0));
    updateSyncBadges();
    if (!silent) toast(`已同步 ${list.length} 条执行结果到服务器`, 'success');
    return true;
  } catch (err) {
    updateSyncBadges();
    if (!silent) toast(`服务端暂不可达（${(err && err.message) || '网络异常'}），${pendingSyncCount()} 条执行结果已离线缓存，恢复后自动同步`, 'error');
    return false;
  } finally { __syncBusy = false; }
}
/* 连接恢复 / 周期性重试：断网期间缓存的数据在网络或服务端恢复后自动补传 */
function startSyncWatcher() {
  if (window.__syncWatcher) return;
  window.__syncWatcher = true;
  window.addEventListener('online', () => {
    if (!pendingSyncCount()) { updateSyncBadges(); return; }
    toast('网络已恢复，正在同步离线缓存的执行结果…');
    flushPendingSync(false);
  });
  window.addEventListener('offline', () => { updateSyncBadges(); });
  setInterval(() => { if (pendingSyncCount()) flushPendingSync(true); }, 30000);
  flushPendingSync(true);
}
window.syncPendingNow = function () { return flushPendingSync(false); };
window.openSyncPanel = function () {
  const list = pendingSyncList();
  const ep = syncEndpoint();
  const rows = list.slice(0, 80).map(x => `<tr><td>${x.at.slice(11)}</td><td>${x.execId}</td><td>${x.caseId}</td><td>${x.field}</td><td>${x.value}</td></tr>`).join('')
    || '<tr><td colspan="5" style="text-align:center;color:#8a9aab">没有待同步的变更</td></tr>';
  modal('保存与同步 · 执行结果', `
    
    <div class="field"><label>数据同步服务地址（留空 = 仅本机保存）</label>
      <input id="syncEp" value="${ep}" placeholder="例如 http://192.168.40.123:3000/api/exec-sync"></div>
    <div class="hint" style="margin:0">当前状态：<b>${syncBadgeText()}</b>　网络：${navigator.onLine === false ? '<span class="chip chip-warn">已离线</span>' : '<span class="chip chip-success">在线</span>'}</div>
    <div class="table-wrap" style="max-height:36vh;margin-top:10px">
      <table><thead><tr><th>时间</th><th>执行任务</th><th>用例编号</th><th>字段</th><th>值</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="form-actions">
      <span class="hint" style="margin:0">待同步 <b>${list.length}</b> 条</span>
      <button class="btn btn-ghost" onclick="closeTopModal()">关闭</button>
      <button class="btn btn-primary" id="syncGo">立即同步</button>
    </div>`);
  $('#syncGo').onclick = () => {
    try { localStorage.setItem(SYNC_ENDPOINT_KEY, $('#syncEp').value.trim()); } catch (e) { }
    if (!syncEndpoint()) { updateSyncBadges(); closeTopModal(); toast('未配置同步服务地址，执行结果仅保存在本机（离线缓存 ' + pendingSyncCount() + ' 条）'); return; }
    flushPendingSync(false).then(() => { closeTopModal(); updateSyncBadges(); });
  };
};
/* 切换执行人范围（全部执行人 / 指定执行人） */
window.setExecScope = function (scope) {
  state.execCase.scope = scope;
  state.execCase.page = 1;
  renderExecCases();
};
/* 从执行任务列表直接进入划分 */
window.openDivideExecFor = function (execId) {
  state.execCase = { execId: execId, page: 1, size: 20, filters: {}, scope: 'all' };
  openDivideExec();
};
/* 按执行人划分执行任务 */
window.openDivideExec = function () {
  if (!guard('task', '任务管理')) return;
  const st = state.execCase;
  const e = DB.execTasks.find(x => x.execId === st.execId);
  const all = execCaseRows(e);
  const people = executorsOf(e);
  if (!execRoleOf(e).isManager) { toast('仅任务管理角色（一级及以上）可调整用例的执行人分配', 'error'); return; }
  if (!people.length) { toast('该执行任务未设置执行人，请先在「修改」中填写执行人'); return; }
  const opts = (cur) => people.map(p => `<option ${cur === p ? 'selected' : ''}>${p}</option>`).join('') + `<option ${!people.includes(cur) ? 'selected' : ''} value="">未分配</option>`;
  const drawTable = () => all.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${r.caseId}</td>
      <td style="white-space:normal">${r.summary || '—'}</td>
      <td>${r.functionPoint || '—'}</td>
      <td>${resultPill(r.result)}</td>
      <td><select class="dvsel" data-idx="${i}">${opts(r.executor)}</select></td>
    </tr>`).join('');
  modal(`调整执行人分配 · ${e.execId}`, `
    <div class="hint">该执行任务有 <b>${people.length}</b> 位执行人（${people.join('、')}）。${e.totals && e.totals.planned !== all.length ? `　<span class="chip chip-warn">本平台展示样例 ${all.length} 条（全量 ${e.totals.planned} 条）</span>` : ''}</div>
    <div class="toolbar" style="box-shadow:none;margin-bottom:12px">
      <span>快捷操作：</span>
      <button class="btn btn-ghost btn-sm" id="dvAvg">按顺序平均分给 ${people.length} 人</button>
      <button class="btn btn-ghost btn-sm" id="dvOne">${people[0]} 执行全部</button>
      <button class="btn btn-ghost btn-sm" id="dvClear">全部置为未分配</button>
    </div>
    <div class="table-wrap" id="dvList" style="max-height:46vh">
      <table><thead><tr><th style="width:50px">序号</th><th>用例编号</th><th>用例概述</th><th>功能点</th><th>执行结果</th><th>执行人</th></tr></thead>
      <tbody>${drawTable()}</tbody></table>
    </div>
    <div class="form-actions">
      <span class="hint" style="margin:0" id="dvSummary"></span>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="dvSave">保存分配</button>
    </div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1200px, 94vw)';
  const syncSummary = () => {
    const picks = $$('.dvsel');
    const cnt = {};
    picks.forEach(s => { const v = s.value || '未分配'; cnt[v] = (cnt[v] || 0) + 1; });
    $('#dvSummary').textContent = '分配结果：' + Object.keys(cnt).map(k => `${k} ${cnt[k]} 条`).join('　');
  };
  const setByIndex = (fn) => { $$('.dvsel').forEach((s, i) => { s.value = fn(i) || ''; }); syncSummary(); };
  $('#dvAvg').onclick = () => setByIndex(i => people[i % people.length]);
  $('#dvOne').onclick = () => setByIndex(() => people[0]);
  $('#dvClear').onclick = () => setByIndex(() => '');
  $$('.dvsel').forEach(s => s.onchange = syncSummary);
  syncSummary();
  $('#dvSave').onclick = () => {
    const picks = $$('.dvsel');
    picks.forEach(s => { all[+s.dataset.idx].executor = s.value; });
    const unassigned = all.filter(r => !r.executor || r.executor === '未分配').length;
    recomputeExecStats(e);
    log('调整执行人分配', `${e.execId}｜${people.join('、')}｜共 ${all.length} 条用例${unassigned ? `（${unassigned} 条未分配）` : ''}`, e.taskId);
    closeTopModal(); renderExecCases();
    toast(`已完成执行人分配调整，共 ${all.length} 条用例`, 'success');
  };
};
/* 提交 Bug：写入平台内置缺陷库（字段与缺陷单据一一对应），自动带出用例 / 执行任务字段，提交后 BUG ID 回填用例 */
window.submitBug = function () {
  if (!guard('bug', '提交 Bug')) return;
  const st = state.execCase;
  const e = DB.execTasks.find(x => x.execId === st.execId);
  if (!e) return;
  const all = execCaseRows(e);
  const picked = $$('.ecchk:checked').map(c => +c.dataset.idx);
  if (!picked.length) { toast('请先勾选发现缺陷的用例'); return; }
  if (picked.length !== 1) { toast('一次提交仅支持一条用例，请只勾选一条'); return; }
  const r = all[picked[0]];
  const t = DB.tasks.find(x => x.id === e.taskId) || {};
  const row = (label, val) => `<tr><td style="width:150px">${label}</td><td style="white-space:normal">${val == null || val === '' ? '—' : val}</td></tr>`;
  modal(`提交 Bug · ${r.caseId}`, `
    
    <h4 class="sub-title">自动带出（用例 / 执行任务 / 当前账号）</h4>
    <table class="detail-table">
      ${row('产品名称', e.model)}${row('产品定位', t.type || '—')}${row('当前测试轮数', e.round)}
      ${row('涉及领域', e.domain)}${row('硬件版本', e.hwVersion)}${row('固件版本', e.fwVersion)}
      ${row('测试项目', r.testProject)}${row('影响特性（测试类型）', r.testType || '功能测试')}
      ${row('前置条件', r.pre)}${row('复现步骤', r.steps)}${row('预期结果', r.expect)}
      ${row('研发负责人', t.contact || '—')}${row('测试负责人', e.executors)}${row('测试确认人', t.testLead || '—')}${row('发起人', DB.currentUser)}
    </table>
    <h4 class="sub-title">填写缺陷信息</h4>
    <div class="form" style="grid-template-columns:1fr 1fr 1fr">
      <div class="field"><label>BUG 标题（必填）</label><input id="bgTitle" value="${(r.summary || '')} 执行失败"></div>
      <div class="field"><label>Bug 来源</label><select id="bgSource">${BUG_SOURCES.map(s => `<option>${s}</option>`).join('')}</select></div>
      <div class="field"><label>缺陷等级</label><select id="bgLevel">${BUG_LEVELS.map(s => `<option ${s === '一般C' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr 1fr">
      <div class="field"><label>缺陷优先级</label><select id="bgPriority">${BUG_PRIORITY.map(s => `<option ${s === '重要不紧急' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>复现频率</label><select id="bgFreq">${BUG_FREQ.map(s => `<option ${s === '必现' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>是否为新引入 Bug</label><select id="bgIsNew">${['否', '是'].map(s => `<option ${s === '是' ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>预期解决时间</label><input id="bgExpectFix" type="date" value="${addDays(14)}"></div>
      <div class="field"><label>实际结果</label><input id="bgActual" value="实际现象与预期结果不一致"></div>
    </div>
    <div class="form" style="grid-template-columns:1fr">
      <div class="field"><label>Bug 描述</label><textarea id="bgDesc" rows="2">执行用例 ${r.caseId} 时发现缺陷，请研发确认。</textarea></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="bgOk">提交缺陷</button>
    </div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1080px, 94vw)';
  $('#bgOk').onclick = () => {
    const title = $('#bgTitle').value.trim();
    if (!title) { toast('请填写 BUG 标题'); return; }
    const id = `BUG-${new Date().getFullYear()}-${String((DB.bugs || []).length + 43).padStart(4, '0')}`;
    DB.bugs = DB.bugs || [];
    DB.bugs.unshift({
      id, caseId: r.caseId, model: e.model, execId: e.execId, source: $('#bgSource').value,
      level: $('#bgLevel').value, priority: $('#bgPriority').value, freq: $('#bgFreq').value,
      isNew: $('#bgIsNew').value, title, testProject: r.testProject, testType: r.testType || '功能测试',
      dev: t.contact || '—', tester: e.executors, submitter: DB.currentUser,
      date: today(), round: e.round, hwVersion: e.hwVersion, fwVersion: e.fwVersion,
      pre: r.pre, steps: r.steps, input: r.input, expect: r.expect,
      actual: $('#bgActual').value.trim(), desc: $('#bgDesc').value.trim(), expectFix: $('#bgExpectFix').value || '—',
      status: '已提交'
    });
    /* BUG ID 回填用例，并同步执行结果为 Fail */
    r.bugIds = (r.bugIds || []).concat([id]);
    r.bugId = id;
    r.bugCount = (r.bugCount || 0) + 1;
    r.result = 'Fail';
    const sel = $(`select.ecres[data-idx="${picked[0]}"]`);
    if (sel) { sel.value = 'Fail'; setResClass(sel, 'Fail'); }
    queueExecSync(e, r, 'result', 'Fail');
    log('提交 Bug', `${id}｜${r.caseId}｜${title}｜${$('#bgLevel').value}｜已写入平台缺陷库并回填用例`, e.taskId);
    closeTopModal(); renderExecCases();
    toast(`BUG ${id} 已提交，用例执行结果已同步标记为 Fail`, 'success');
  };
};

window.batchPass = function () {
  if (!guard('exec', '任务执行')) return;
  /* 仅本人名下（可操作）的用例可批量标记，他人名下用例被禁止勾选 */
  const picked = $$('.ecchk:checked').filter(c => !c.disabled);
  if (!picked.length) { toast('请先勾选要标记通过的用例（仅本人名下用例可操作）'); return; }
  const st = state.execCase;
  const e = DB.execTasks.find(x => x.execId === st.execId);
  const all = execCaseRows(e);
  let n = 0;
  const changed = [];
  picked.forEach(c => {
    const idx = +c.dataset.idx;
    const sel = $$(`select.ecres[data-idx="${idx}"]`)[0];
    /* 只改结果与配色类：className 整体覆盖会抹掉下拉增强层类，导致原生 select 与增强显示层同时出现 */
    if (sel && !sel.disabled) { sel.value = 'Pass'; setResClass(sel, 'Pass'); }
    if (all[idx] && all[idx].result !== 'Pass') {
      changed.push(`${all[idx].caseId}（${all[idx].result || '未填写'}→Pass）`);
      all[idx].result = 'Pass'; queueExecSync(e, all[idx], 'result', 'Pass'); n++;
    }
  });
  if (n) {
    recomputeExecStats(e);
    save();
    syncExecProgress(e, all);
    /* 批量改判同样留痕：记录被改判的用例编号及其原结果 */
    log('批量标记执行结果', `${e.execId}｜${n} 条改为 Pass｜${changed.slice(0, 12).join('、')}${changed.length > 12 ? ` 等 ${changed.length} 条` : ''}`,
      e.taskId, { module: '执行', objType: '执行明细', objId: changed.length ? changed.map(x => x.split('（')[0]).join(',') : '' });
    flashExecSaved(e);
  }
  $$('.ecchk').forEach(c => { c.checked = false; });
  const cnt = $('#ecSelected');
  if (cnt) cnt.textContent = '0';
  toast(n ? `已批量标记 ${n} 条为 Pass（已自动保存）` : '勾选的用例已是 Pass，无需变更', 'success');
};
window.transferCases = function () {
  if (!guard('task', '任务管理')) return;
  const st = state.execCase;
  const e = DB.execTasks.find(x => x.execId === st.execId);
  const picked = $$('.ecchk:checked').filter(c => !c.disabled).map(c => +c.dataset.idx);
  if (!picked.length) { toast('请先勾选要移交的用例（仅本人名下用例可操作）'); return; }
  const people = Array.from(new Set(executorsOf(e).concat(DB.deptMembers)));
  formModal(`移交用例（已选 ${picked.length} 条）`, [
    { key: 'to', label: '移交给（可指定执行人，也可从部门成员中选）', type: 'select', options: people },
    { key: 'note', label: '移交说明', type: 'textarea', value: '因任务调整，移交以上用例执行。' }
  ], v => {
    const all = execCaseRows(e);
    picked.forEach(i => { if (all[i]) all[i].executor = v.to; });
    if (!executorsOf(e).includes(v.to)) { e.executors = executorsOf(e).concat(v.to).join(' '); }
    recomputeExecStats(e);
    log('移交用例', `${e.execId}｜${picked.length} 条移交给 ${v.to}`, e.taskId);
    closeTopModal(); renderExecCases(); toast(`已移交 ${picked.length} 条给 ${v.to}`, 'success');
  });
};
/* 任务列表里对某个执行人整批移交（默认只移交未执行的用例） */
window.transferByExecutor = function (execId, from) {
  const e = DB.execTasks.find(x => x.execId === execId);
  const role = execRoleOf(e);
  /* 执行人只能移交自己名下的用例；任务管理角色可代为移交 */
  if (role.isExecutor && !role.isManager && from !== role.me) { toast('执行人只能移交自己名下的用例', 'error'); return; }
  const rows = execCaseRows(e).filter(r => r.executor === from);
  const pending = rows.filter(r => !r.result || r.result === 'N/A' || r.result === '未执行').length;
  const targets = Array.from(new Set(executorsOf(e).concat(DB.deptMembers))).filter(x => x !== from);
  modal(`移交用例 · ${from}（${e.execId}）`, `
    <div class="hint">${from} 在该执行任务下共 <b>${rows.length}</b> 条用例，其中未执行 <b>${pending}</b> 条。</div>
    <table class="detail-table">
      <tr><td style="width:110px">移交给：</td><td><select id="tfTo">${targets.map(t => `<option>${t}</option>`).join('')}</select></td></tr>
      <tr><td>移交范围：</td><td><select id="tfScope">
        <option value="pending">仅未执行用例（${pending} 条）</option>
        <option value="all">全部用例（${rows.length} 条）</option>
      </select></td></tr>
      <tr><td>移交说明：</td><td><input id="tfNote" style="width:100%" value="因任务调整，移交以上用例执行。"></td></tr>
    </table>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="tfOk">确认移交</button>
    </div>`);
  $('#tfOk').onclick = () => {
    const to = $('#tfTo').value, scope = $('#tfScope').value, note = $('#tfNote').value.trim();
    const picked = scope === 'all' ? rows : rows.filter(r => !r.result || r.result === 'N/A' || r.result === '未执行');
    if (!picked.length) { toast('没有需要移交的用例'); return; }
    picked.forEach(r => { r.executor = to; });
    if (!executorsOf(e).includes(to)) e.executors = executorsOf(e).concat(to).join(' ');
    recomputeExecStats(e);
    log('移交用例', `${e.execId}｜${from} → ${to}｜${scope === 'all' ? '全部' : '仅未执行'} ${picked.length} 条${note ? '｜' + note : ''}`, e.taskId);
    closeTopModal(); renderTaskExec(e.taskId);
    toast(`已将 ${picked.length} 条用例从 ${from} 移交给 ${to}`, 'success');
  };
};
/* ===== 执行页「新增 / 修改用例」共用：表单字段 + 落库 =====
   字段与产品用例库「新增专属用例」一致（20 个可编辑项）；用例编号由系统生成且只读；
   执行人不再手选：新增时 = 当前登录账号，修改时沿用原执行人。
   落库规则：一律生成「新的产品专属用例」（写入该产品的产品专属增补），不改动产品用例库 / 模块用例库中的原用例。 */
const EXEC_TEST_TYPES = ['功能测试', '易用性测试', '兼容性测试', '性能测试', '可靠性测试', '安全测试'];
function execCaseFormFields(vals, meta) {
  vals = vals || {}; meta = meta || {};
  const p = meta.product || null;
  const pickOpt = (k, list, def) => (list.indexOf(vals[k]) >= 0 ? vals[k] : def);
  const txt = (k, def) => {
    const v = vals[k];
    return (v == null || v === '' || v === '—') ? def : v;
  };
  const caseNo = meta.caseNo || '';
  const isEdit = meta.mode === 'edit';
  return [
    {
      key: 'caseId', label: '用例编号（系统自动生成）', type: 'text', readonly: true,
      value: caseNo || '保存时生成临时编号',
      hint: p
        ? `产品专属增补临时编号，保存后自动回流到产品用例库「${p.model}」${isEdit ? '；原用例保持不变' : '；如需纳入模块用例库，再到产品用例库申请回流'}`
        : `该执行任务的产品型号「${meta.model || ''}」不在产品用例库中，保存后仅加入执行任务`
    },
    {
      key: 'executor', label: '执行人（系统带出）', type: 'text', readonly: true, value: meta.executor || DB.currentUser,
      hint: isEdit ? '沿用原执行人，修改后仍由该执行人执行' : '执行人 = 新增该用例的登录账号，不再手工选择'
    },
    {
      key: 'module', label: '功能模块（支持自定义填写）', type: 'text', list: DB.stdModules.map(m => m.name),
      value: txt('module', ''), placeholder: '选择或直接输入新模块名称',
      },
    { key: 'caseDomain', label: '用例领域', type: 'select', options: DOMAIN_OPTIONS, value: pickOpt('domain', DOMAIN_OPTIONS, normDomain('', (p && p.domain) ? normDomain(p.domain, '固件') : '固件')) },
    { key: 'caseSource', label: '用例来源', type: 'select', options: SOURCE_OPTIONS, value: pickOpt('caseSource', SOURCE_OPTIONS, '需求') },
    { key: 'testType', label: '测试类型', type: 'select', options: EXEC_TEST_TYPES, value: pickOpt('testType', EXEC_TEST_TYPES, '功能测试') },
    { key: 'summary', label: '用例概述', type: 'text', value: txt('summary', '') },
    { key: 'functionPoint', label: '功能点', type: 'text', value: txt('functionPoint', ''), placeholder: '不填默认取功能模块名称' },
    { key: 'testPoint', label: '测试点', type: 'text', value: txt('testPoint', '功能逻辑') },
    { key: 'level', label: '用例等级', type: 'select', options: ['L1', 'L2', 'L3'], value: pickOpt('level', ['L1', 'L2', 'L3'], 'L3') },
    { key: 'pre', label: '前置条件', type: 'textarea', value: txt('pre', '') },
    { key: 'steps', label: '操作步骤', type: 'textarea', value: txt('steps', '') },
    { key: 'input', label: '输入数据', type: 'text', value: txt('input', '无') },
    { key: 'expect', label: '预期结果', type: 'textarea', value: txt('expect', '') },
    { key: 'remark', label: '备注', type: 'text', value: txt('remark', '无') },
    { key: 'testProject', label: '测试项目', type: 'text', value: txt('testProject', ''), placeholder: '不填默认取功能模块名称' },
    { key: 'minutes', label: '手动测试时间（min）', type: 'number', value: txt('manualMin', '') },
    { key: 'autoFlag', label: '自动化标志', type: 'select', options: ['否', '是'], value: pickOpt('autoFlag', ['否', '是'], '否') },
    { key: 'autoTool', label: '自动化工具', type: 'text', value: txt('autoTool', ''), placeholder: '自动化标志为「是」时填写' },
    { key: 'autoTime', label: '自动化测试时间（min）', type: 'number', value: txt('autoTime', '') },
    {
      key: 'marketBug', label: '市场反馈 BUG', type: 'text', value: txt('marketBug', ''), placeholder: '市场问题单号 / BUG 编号',
      dependsOn: { key: 'caseSource', equals: MARKET_SOURCE }, required: { key: 'caseSource', equals: MARKET_SOURCE }
    },
    {
      key: 'marketBugDate', label: '市场反馈时间', type: 'text', value: txt('marketBugDate', ''), placeholder: 'YYYY-MM-DD',
      dependsOn: { key: 'caseSource', equals: MARKET_SOURCE }, required: { key: 'caseSource', equals: MARKET_SOURCE }
    }
  ];
}
/* 表单值 → 新产品专属用例 + 执行任务行。返回 { caseId, prodId, row, rows }。
   opts.executor：执行人（新增=当前账号，修改=沿用原执行人）
   opts.editedFrom：被修改的原用例编号（追溯用）
   opts.inheritResult：继承执行结论的原执行行（「修改并移除原用例」时沿用结果，避免进度回退） */
function persistExecCaseFromForm(e, v, opts) {
  opts = opts || {};
  const p = DB.products.find(x => x.model === e.model);
  const collector = DB.currentUser;
  const executor = opts.executor || collector;
  const editedFrom = opts.editedFrom || '';
  const module = String(v.module || '').trim();
  const autoOn = v.autoFlag === '是';
  const marketOn = v.caseSource === MARKET_SOURCE;
  const domain = normDomain(v.caseDomain, '固件');
  const summary = String(v.summary).trim();
  const testProject = String(v.testProject || '').trim() || module;
  const functionPoint = String(v.functionPoint || '').trim() || module;
  const testPoint = String(v.testPoint || '').trim() || '功能逻辑';
  const minutes = v.minutes === '' ? '' : v.minutes;
  const autoTool = autoOn ? (String(v.autoTool || '').trim() || '—') : '—';
  const autoTime = autoOn && v.autoTime !== '' ? v.autoTime : '—';
  const marketBug = marketOn ? String(v.marketBug || '').trim() : '';
  const marketBugDate = marketOn ? String(v.marketBugDate || '').trim() : '';
  /* ① 始终生成新的产品专属用例（不动库中原用例） */
  let prodId = '';
  if (p) {
    prodId = prodCaseNo(p.model, 'A' + String(nextAddedSeq(p)).padStart(2, '0'));
    p.added.push({
      id: prodId, module, domain, summary, level: v.level, caseSource: v.caseSource,
      date: today(), reviewer: collector, feedback: '已回流产品用例库', fromExec: e.execId, editedFrom,
      pre: v.pre, steps: v.steps, input: v.input, expect: v.expect, remark: v.remark,
      testType: v.testType, functionPoint, testPoint, testProject, minutes,
      autoFlag: v.autoFlag, autoTool, autoTime, autoUpdatedAt: autoOn ? today() : '—',
      bugCount: 0, bugIds: [], bugId: '—', marketBug, marketBugDate
    });
  }
  /* ② 执行任务行 */
  const rows = execCaseRows(e);
  const caseId = prodId || ('TMP-' + ymd() + '-' + String(rows.length + 1).padStart(2, '0'));
  const src = opts.inheritResult || null;
  const row = {
    seq: rows.length + 1, id: caseId, caseId,
    module, branch: prodId ? '产品专属' : '产品通用', summary, level: v.level,
    source: prodId ? '产品专属增补' : '执行页新增', caseSource: v.caseSource, prodCaseId: prodId,
    result: src ? (src.result || '') : '', resultNote: src ? (src.resultNote || '') : '',
    auto: src ? (src.auto || '否') : '否', actualTime: src ? (src.actualTime || '') : '',
    executor, testType: v.testType, functionPoint, testPoint, testProject, domain,
    designer: collector, manualMin: minutes, autoFlag: v.autoFlag, autoTool, autoTime,
    autoUpdatedAt: autoOn ? today() : '—', remark: v.remark,
    pre: v.pre, steps: v.steps, input: v.input, expect: v.expect, marketBug, marketBugDate, editedFrom
  };
  rows.push(row);
  /* 执行人若不是本任务既有执行人（如管理者代操作），补入执行人列表，保证他对该用例有操作权 */
  const people = executorsOf(e);
  if (!people.includes(executor)) {
    e.executors = people.concat([executor]).join('、');
    if (!DB.deptMembers.includes(executor)) DB.deptMembers.push(executor);
  }
  recomputeExecStats(e);
  return { caseId, prodId, row, rows };
}
/* 执行页新增用例：
   ① 用例编号由系统生成（产品专属增补的临时编号「产品型号-A序号」），不可手填；
   ② 执行人不再选择：谁新增就归谁执行；
   ③ 字段与产品用例库「新增专属用例」对齐（分析维度 / 内容 / 自动化 / 市场反馈）；
   ④ 提交后自动回流到产品用例库（写入该产品的产品专属增补），再由产品用例库申请回流模块用例库。 */
window.addCaseInExec = function () {
  if (!guard('exec', '任务执行')) return;
  const st = state.execCase;
  const e = DB.execTasks.find(x => x.execId === st.execId);
  if (!e) return;
  const p = DB.products.find(x => x.model === e.model);
  const collector = DB.currentUser;
  const previewNo = p ? prodCaseNo(p.model, 'A' + String(nextAddedSeq(p)).padStart(2, '0')) : '';
  formModal('在执行任务中新增用例',
    execCaseFormFields({}, { product: p, caseNo: previewNo, executor: collector, mode: 'add', model: e.model }),
    v => {
      const module = String(v.module || '').trim();
      if (!module) { toast('请填写功能模块'); return false; }
      if (!String(v.summary || '').trim()) { toast('请填写用例概述'); return false; }
      ensureModuleExists(module, v.caseDomain, '执行页新增用例');
      const saved = persistExecCaseFromForm(e, v, { executor: collector });
      log('执行页新增用例', `${e.execId}｜${saved.caseId}｜${String(v.summary).trim()}｜执行人 ${saved.row.executor}`
        + `${saved.prodId ? `｜已自动回流产品用例库（${p.model}）` : ''}`, e.taskId);
      closeTopModal(); renderExecCases();
      toast(saved.prodId ? `已新增用例 ${saved.caseId}，并自动回流到产品用例库` : `已新增用例 ${saved.caseId}（未关联产品用例库，未回流）`, 'success');
    },
    '新增的用例自动回流到<b>产品用例库</b>（产品专属增补）：编号由系统生成、执行人取当前登录账号；如需纳入模块用例库，再到「产品用例库」申请回流。');
};
/* 执行页修改用例：修改不会直接改动库中的用例，而是生成一条新的产品专属用例（新编号、自动回流产品用例库）。
   提交时三种去向：关闭（不保存）/ 提交并移除原用例 / 提交不移除原用例。 */
window.editCaseInExec = function (execId, idx) {
  if (!guard('exec', '任务执行')) return;
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e) return;
  if (e.finished) { toast('该执行任务已结束，记录已封存，不可修改'); return; }
  const origin = execCaseRows(e)[idx];
  if (!origin) return;
  if (execRowLocked(origin, e)) { toast('仅可查看：该用例不归你执行', 'error'); return; }
  const p = DB.products.find(x => x.model === e.model);
  const newNo = p ? prodCaseNo(p.model, 'A' + String(nextAddedSeq(p)).padStart(2, '0')) : '';
  const executor = origin.executor || DB.currentUser;
  formModal(`修改执行用例 · ${origin.caseId}`,
    execCaseFormFields(origin, { product: p, caseNo: newNo, executor, mode: 'edit', model: e.model }),
    (v, act) => {
      const module = String(v.module || '').trim();
      if (!module) { toast('请填写功能模块'); return false; }
      if (!String(v.summary || '').trim()) { toast('请填写用例概述'); return false; }
      ensureModuleExists(module, v.caseDomain, '执行页修改用例');
      const removeOrigin = act !== 'keep';
      const saved = persistExecCaseFromForm(e, v, {
        executor,
        editedFrom: origin.caseId,
        /* 「提交并移除原用例」时继承原执行结论，避免修改后进度倒退；保留原用例时新用例结果为空 */
        inheritResult: removeOrigin ? origin : null
      });
      if (removeOrigin) {
        const i2 = saved.rows.indexOf(origin);
        if (i2 >= 0) saved.rows.splice(i2, 1);
      }
      recomputeExecStats(e);
      log(removeOrigin ? '修改执行用例（移除原用例）' : '修改执行用例（保留原用例）',
        `${e.execId}｜${origin.caseId} → ${saved.caseId}｜${String(v.summary).trim()}｜执行人 ${saved.row.executor}`
        + `${saved.prodId ? `｜新产品专属用例（${p.model}）` : '｜未关联产品用例库'}`, e.taskId);
      closeTopModal(); renderExecCases();
      toast(removeOrigin
        ? `已生成新用例 ${saved.caseId}，并从本任务移除原用例 ${origin.caseId}（用例库中的原用例不受影响）`
        : `已生成新用例 ${saved.caseId}，原用例 ${origin.caseId} 保留`, 'success');
    },
    `修改会生成<b>新的产品专属用例</b>（编号 ${newNo || '临时编号'}），<b>不会改动产品用例库 / 模块用例库中的原用例</b>；`
    + `「提交并移除原用例」会同时把本任务中的 ${origin.caseId} 移除，并沿用其执行结论。`,
    { okText: '提交并移除原用例', actions: [{ id: 'keep', text: '提交不移除原用例' }] });
};
/* 执行页移除用例：仅从【本执行任务】中移除该条执行记录，不动产品用例库 / 模块用例库 */
window.removeCaseInExec = function (execId, idx) {
  if (!guard('exec', '任务执行')) return;
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e) return;
  if (e.finished) { toast('该执行任务已结束，记录已封存，不可修改'); return; }
  const rows = execCaseRows(e);
  const r = rows[idx];
  if (!r) return;
  if (execRowLocked(r, e)) { toast('仅可查看：该用例不归你执行', 'error'); return; }
  confirmModal('移除执行用例', `<p>确定从执行任务 <b>${e.execId}</b> 中移除用例 <b>${r.caseId}</b>（${r.summary}）？</p>
    `,
    () => {
      const i2 = rows.indexOf(r);
      if (i2 >= 0) rows.splice(i2, 1);
      recomputeExecStats(e);
      log('移除执行用例', `${e.execId}｜${r.caseId}｜${r.summary}｜执行人 ${r.executor}（仅移除本执行任务中的记录，用例库不受影响）`, e.taskId);
      closeTopModal(); renderExecCases();
      toast(`已从本执行任务移除 ${r.caseId}（用例库不受影响）`, 'success');
    }, '确定移除');
};
/* 结束执行任务：先做必填校验（执行结果 / 实际测试时间），通过后封存（结束后不可再修改） */
function execFinishCheck(e) {
  const rows = execCaseRows(e);
  const noResult = rows.filter(r => !r.result || r.result === 'N/A' || r.result === '未执行');
  const noTime = rows.filter(r => (r.actualTime == null || String(r.actualTime).trim() === '') && (!r.auto || r.auto === '否'));
  return { rows: rows.length, noResult: noResult, noTime: noTime };
}
function finishExecTask(e, force) {
  const ck = execFinishCheck(e);
  if (!force && (ck.noResult.length || ck.noTime.length)) {
    const brief = (arr, label) => arr.length
      ? `<p style="color:#e74c3c">${label} ${arr.length} 条：${arr.slice(0, 5).map(r => r.caseId).join('、')}${arr.length > 5 ? ' …' : ''}</p>` : '';
    confirmModal('无法结束：存在未填写项', `
      <p>执行任务 <b>${e.execId}</b> 共 ${ck.rows} 条用例，以下字段为结束前的必填项，请先补全：</p>
      ${brief(ck.noResult, '未填写「执行结果」')}
      ${brief(ck.noTime, '未填写「实际测试时间」')}
      `,
      () => { closeTopModal(); finishExecTask(e, true); },
      '仍然结束');
    return;
  }
  e.finished = true;
  e.finishedAt = nowStr();
  log('结束执行任务', `${e.execId}｜${e.name}｜计划 ${ck.rows} 条｜未填执行结果 ${ck.noResult.length} 条｜未填实际测试时间 ${ck.noTime.length} 条${force ? '（强制结束）' : ''}`, e.taskId);
  closeTopModal();
  renderTaskExec(e.taskId);
  toast('执行任务已结束，记录已封存（不可再修改）', 'success');
}
window.endExecTask = function () {
  if (!guard('task', '任务管理')) return;
  const e = DB.execTasks.find(x => x.execId === state.execCase.execId);
  if (!e) return;
  if (!execRoleOf(e).isManager) { toast('仅任务管理角色（一级及以上）可结束执行任务', 'error'); return; }
  const ck = execFinishCheck(e);
  if (!ck.noResult.length && !ck.noTime.length) {
    confirmModal('结束执行任务', `<p>确定结束执行任务 <b>${e.execId}</b>（${e.name}）？共 ${ck.rows} 条用例，执行结果与实际测试时间均已填写。</p>
      `, () => finishExecTask(e, true));
    return;
  }
  finishExecTask(e, false);
};
window.endExecTaskFor = function (execId) {
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e) return;
  finishExecTask(e, false);
};
window.reopenExec = function (execId) {
  if (!guard('task', '任务管理')) return;
  /* 与任务重开保持一致：仅一级及以上账号可重新开启执行任务 */
  if (!isLv1OrAbove()) {
    toast(`仅一级及以上账号可重新开启执行任务（当前角色：${DB.currentRole}）`, 'error');
    return;
  }
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e) return;
  confirmModal('重新开启执行任务', `<p>确定重新开启 <b>${execId}</b>（${e.name}）？重新开启后本轮记录可继续修改。</p>
    `, () => {
    e.finished = false;
    delete e.finishedAt;
    log('重新开启执行任务', `${execId}｜${e.name}｜操作人 ${DB.currentUser}（${DB.currentRole}）`, e.taskId);
    closeTopModal(); renderTaskExec(e.taskId); toast('执行任务已重新开启', 'success');
  }, '确定重新开启');
};
window.toggleExecGroup = function () {
  state.execGroupByPerson = !state.execGroupByPerson;
  renderTaskExec(state.currentTaskId || DB.tasks[0].id);
};
window.caseDetailInExec = function (execId, idx) {
  const e = DB.execTasks.find(x => x.execId === execId);
  if (!e) return;
  const r = execCaseRows(e)[idx];
  if (!r) return;
  /* 1) 执行记录字段（全部）：只读展示，避免复用表格里的输入框控件 */
  const rec = Object.assign({}, r, { __seq: r.seq });
  const execRows = COL_SCHEMAS.detail.fields.filter(f => f.key !== 'ops')
    .map(f => [f.label, f.key === 'result' ? resultPill(r.result) : fieldValueHtml(f, rec, true)]);
  const sections = [{ title: '执行记录字段（全部）', rows: execRows }];
  /* 2) 用例字段（全部）：回溯来源用例，模块用例 / 产品用例均展示其全量字段 */
  const src = sourceCaseOfExecRow(e, r);
  if (src && src.stdCase) {
    sections.push({ title: `源模块用例字段（全部）· ${stdCaseNoLabel(src.stdCase)}`, rows: stdCaseAllFields(src.stdCase) });
  } else if (src && src.prodRow) {
    sections.push({ title: `产品用例字段（全部）· ${src.prodRow.id}`, rows: prodCaseAllFields(src.prodRow) });
  } else {
    sections.push({
      title: '用例字段（执行记录快照）', rows: [
        ['用例编号', r.caseId], ['功能模块', r.module || '—'], ['分支类型', r.branch || '—'], ['用例领域', r.domain || '—'],
        ['用例等级', r.level || '—'], ['用例来源', r.source || '—'], ['测试类型', r.testType || '—'], ['测试项目', r.testProject || '—'],
        ['功能点', r.functionPoint || '—'], ['测试点', r.testPoint || '—'], ['用例概述', r.summary || '—'], ['前置条件', r.pre || '—'],
        ['详细步骤', r.steps || '—'], ['输入数据', r.input || '—'], ['预期结果', r.expect || '—'], ['备注', r.remark || '—'],
        ['手动测试时间(min)', r.manualMin == null || r.manualMin === '' ? '—' : r.manualMin],
        ['自动化标志', r.autoFlag || '—'], ['设计者', r.designer || '—']
      ]
    });
  }
  allFieldsModal('用例详情 · ' + r.caseId, sections, '');
};

window.delExec = function (execId) {
  const e = DB.execTasks.find(x => x.execId === execId);
  confirmModal('删除执行任务', `<p>确定删除执行任务 <b>${execId}</b>（${e.name}）？</p>`, () => {
    DB.execTasks = DB.execTasks.filter(x => x.execId !== execId);
    log('删除执行任务', execId, e.taskId);
    closeTopModal(); renderTaskExec(e.taskId); toast('已删除');
  });
};

window.endTask = function (taskId) {
  const task = DB.tasks.find(t => t.id === taskId);
  const left = DB.execTasks.filter(e => e.taskId === taskId).reduce((n, e) => n + execStats(e).notRun, 0);
  confirmModal('结束任务', `<p>确定结束任务 <b>${task.name}</b>？</p>${left ? `<p style="color:#e74c3c">当前仍有 ${left} 条用例未执行。</p>` : ''}`, () => {
    task.finished = '是';
    log('结束任务', `${taskId}｜${task.name}`, taskId);
    closeTopModal(); renderTaskExec(taskId); toast('任务已结束');
  });
};

window.openTaskDetail = function (taskId) {
  const t = DB.tasks.find(x => x.id === taskId);
  const d = Object.assign({}, DB.taskDetail, { 任务编号: t.id, 任务类型: t.type, 任务名称: t.name, 产品经理: t.productManager, 项目经理: t.pm, 接口人: t.contact, 测试主负责人: t.testLead, 是否完结: t.finished, 用例来源: t.caseSource });
  modal('任务详情', `<table class="detail-table">${Object.entries(d).map(([k, v]) => `<tr><td>${k}</td><td>${v || ''}</td><td></td><td></td></tr>`).join('')}</table>`);
};

/* ---------- 审核中心 ---------- */
function renderReviews() {
  const isModule = state.reviewTab === 'module';
  const list = reviewList(isModule ? 'module' : 'product');
  $('#page').innerHTML = `
    <div class="toolbar">
      <button class="btn ${isModule ? 'btn-primary' : 'seg-off'}" id="tabModule">模块用例审核（部门内相关人员）</button>
      <button class="btn ${isModule ? 'seg-off' : 'btn-primary'}" id="tabProduct">产品用例审核（产品项目内相关人员）</button>
    </div>
    <div class="panel" style="border-top:1px solid var(--border)">
      <div class="panel-header">
        <h2 class="panel-title">${isModule ? '模块用例审核' : '产品用例审核'}</h2>
        <div class="actions">
          <span class="chip" style="background:${isModule ? '#2980b9' : '#f39c12'}">${isModule ? '审核范围：测试部门内相关人员' : '审核范围：产品项目相关人员'}</span>
          ${can('reviewCreate') ? `<button class="btn btn-primary" onclick="newReview('${isModule ? 'module' : 'product'}')">发起审核</button>` : ''}
        </div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>审核单号</th><th>类型</th><th>审核对象</th><th>${isModule ? '功能模块' : '所属产品'}</th><th>提交人</th><th>提交日期</th><th>审核期限</th><th>参会</th><th>进度</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${list.map(r => {
          const voted = r.opinions.length, total = r.participants.length || 0;
          return `<tr>
          <td>${r.id}</td><td>${r.type}</td><td>${r.target}</td><td>${r.module || r.product}</td>
          <td>${r.submitter}</td><td>${r.submitDate}</td><td>${r.deadline}</td>
          <td class="nowrap">${total ? `${total} 人` : '待组织'}${r.note ? ' <span class="link" onclick="openReview(\'' + r.id + '\',\'' + (isModule ? 'module' : 'product') + '\')">说明</span>' : ''}</td>
          <td class="nowrap"><span class="prog"><span style="width:${total ? Math.round(voted * 100 / total) : 0}%"></span></span> ${voted}/${total}</td>
          <td>${pill(r.status)}</td>
          <td><span class="link" onclick="openReview('${r.id}','${isModule ? 'module' : 'product'}')">${isOpenReview(r) && !hasVoted(r) && (!total || r.participants.includes(DB.currentUser)) ? '去审核' : '审核详情'}</span></td>
        </tr>`; }).join('') || '<tr><td colspan="11" class="empty">暂无审核单</td></tr>'}</tbody></table>
      </div>
    </div>
    ${exportTodoPanelHtml()}`;
  $('#tabModule').onclick = () => { state.reviewTab = 'module'; renderReviews(); };
  $('#tabProduct').onclick = () => { state.reviewTab = 'product'; renderReviews(); };
}

window.newReview = function (bucket) {
  if (!guard('edit')) return;
  const isModule = bucket === 'module';
  const pairs = Array.from(new Set(DB.stdCases.map(c => c.module + '||' + c.branch)))
    .map(k => { const a = k.split('||'); return `${a[0]} · ${a[1]}（模块用例 ${DB.stdCases.filter(c => c.module === a[0] && c.branch === a[1]).length} 条）`; });
  const opts = isModule ? pairs.concat(DB.stdModules.map(m => `${m.name}_测试方案_V1.0_${ymd()}`))
    : DB.products.map(p => `${p.model}_产品测试用例_V${p.planVersion}_${ymd()}`);
  formModal(isModule ? '发起模块用例审核' : '发起产品用例审核', [
    { key: 'type', label: '审核类型', type: 'select', options: isModule ? ['测试用例', '测试方案'] : ['产品测试用例', '产品测试方案'] },
    { key: 'target', label: '审核对象', type: 'select', options: opts },
    { key: 'participants', label: isModule ? '参会人员（测试部门内）' : '参会人员（产品项目内）', type: 'multi', options: isModule ? DB.deptMembers : Array.from(new Set(DB.products.flatMap(p => DB.productMembers[p.model] || []))), value: isModule ? DB.deptMembers.slice(0, 4) : [] },
    { key: 'note', label: '修改说明', type: 'textarea' }
  ], v => {
    if (!v.participants.length) { toast('请选择参会人员'); return false; }
    if (isModule) {
      const modName = DB.stdModules.map(m => m.name).find(n => v.target.indexOf(n) === 0) || (v.target.split('_')[0] || '');
      const id = nextId('MRV-2026-', DB.moduleReviews);
      DB.moduleReviews.unshift({ id, type: v.type, target: v.target, module: modName, submitter: DB.currentUser, submitDate: today(), deadline: addDays(v.type === '测试方案' ? 5 : 1), scope: '部门内（模块用例审核）', status: '审核中', participants: v.participants, opinions: [], note: v.note || '', resubmits: 0 });
      log('发起模块用例审核', `${id}｜${v.target}｜参会 ${v.participants.join('、')}${v.note ? `｜说明：${v.note}` : ''}`);
    } else {
      const model = (v.target.split('_')[0] || '');
      const id = nextId('PRV-2026-', DB.productReviews);
      DB.productReviews.unshift({ id, type: v.type, target: v.target, product: model, submitter: DB.currentUser, submitDate: today(), deadline: addDays(3), scope: '项目内（产品用例审核）', status: '审核中', participants: v.participants, opinions: [], note: v.note || '', resubmits: 0 });
      const p = DB.products.find(x => x.model === model);
      if (p) p.reviewStatus = '产品用例审核中（项目内）';
      log('发起产品用例审核', `${id}｜${v.target}｜参会 ${v.participants.join('、')}${v.note ? `｜说明：${v.note}` : ''}`);
    }
    closeTopModal(); state.tab = 'reviews'; state.reviewTab = bucket; renderApp(); toast('审核已发起', 'success');
  });
};

/* ---------- 审核详情：被审用例内容（字段自选，任何人员可查看） ---------- */
/* 审核单对应的用例内容，三种来源：
   ① 审核单锁定了用例集合（用例编写后「提交模块用例审核」生成的单）→ 严格按锁定集合展示，与逐条结论一一对应；
   ② 审核中心发起的「功能模块 · 分支」审核 → 按审核对象实时取该模块 · 分支的标准用例（测试方案审核取该模块全部用例）；
   ③ 产品用例审核 → 按审核对象产品实时取该产品当前用例清单（引用模块库 + 引用产品用例 + 专属增补）。 */
function reviewCaseRows(r, bucket) {
  if (bucket === 'module') {
    const ids = (r.caseIds || []).filter(id => stdCaseById(id));
    if (ids.length) return { rows: ids.map(id => stdCaseById(id)).filter(Boolean), from: 'snapshot' };
    const t = String(r.target || '');
    const mod = r.module || t.split('_')[0] || '';
    const seg = t.split('（')[0].split(' · ');
    const branch = seg.length > 1 ? normBranch(seg[1].trim()) : '';
    const rows = DB.stdCases.filter(c => c.module === mod && (!branch || normBranch(c.branch) === branch));
    return { rows, from: 'live', desc: `${mod}${branch ? ' · ' + branch : ''}${r.type === '测试方案' ? '（该模块全部标准用例）' : ''}` };
  }
  const p = DB.products.find(x => x.model === r.product);
  return { rows: p ? prodCaseRows(p) : [], from: 'live', desc: p ? `${p.model} 的产品用例清单（引用模块库 + 引用产品用例 + 专属增补）` : '' };
}
/* 审核详情里的「用例内容」区块：字段可选（可选范围 = 该库全部用例字段）+ 每行「全部字段」入口 */
function reviewCaseBlockHtml(r, bucket, info) {
  const rows = info.rows || [];
  if (!rows.length) {
    return `<div class="hint" style="margin-top:16px">暂无可展示的用例内容（${info.from === 'snapshot'
      ? '审核单锁定的用例已不在库中' : `审核对象「${r.target}」下没有匹配的用例`}）。</div>`;
  }
  const snap = info.from === 'snapshot';
  const key = REVIEW_COL_KEY[bucket] || 'revstd';
  /* 行首固定列：模块用例审核给「逐条结论 + 全部字段」，产品用例审核只给「全部字段」入口 */
  const leadHead = bucket === 'module'
    ? '<th style="width:172px">逐条结论 / 全部字段</th>'
    : '<th style="width:76px">全部字段</th>';
  const leadCell = bucket === 'module'
    ? c => `<td class="rev-act">${reviewVerdictCell(c)}<span class="link" onclick="openStdDetail('${c.id}')">查看</span></td>`
    : r => `<td class="rev-act"><span class="link" onclick="openProdCaseDetail('${r.model}','${r.id}')">查看</span></td>`;
  return `
    <div class="rev-head">
      <h4>${snap ? '逐条审核用例' : '审核用例内容'} <span class="chip">共 ${rows.length} 条${snap ? '，pass 入库 / decline 退回' : ''}</span></h4>
      <span class="rev-head-actions">
        
        <button class="btn btn-ghost btn-sm" onclick="openReviewColPicker('${bucket}')">用例字段（${colsOf(key).length}）</button>
      </span>
    </div>
    <div class="table-wrap" style="max-height:34vh">${tableByCols(key, rows, { compact: true, leadHead: leadHead, leadCell: leadCell })}</div>
    `;
}
/* 当前页面上已勾选但还没提交的逐条结论（切换展示字段时不让用户白选一遍） */
function currentVerdicts() {
  const m = {};
  $$('.cvsel').forEach(s => { if (s.value) m[s.dataset.id] = s.value; });
  return m;
}
window.openReviewColPicker = function (bucket) {
  __revPending = { id: (__revView || {}).id, map: currentVerdicts() };
  openColPicker(REVIEW_COL_KEY[bucket] || 'revstd');
};

window.openReview = function (id, bucket) {
  const r = reviewList(bucket).find(x => x.id === id);
  if (!r) return;
  const u = DB.currentUser;
  const mine = r.opinions.find(o => o[0] === u);
  const total = r.participants.length;
  const isMember = !total || r.participants.includes(u);
  const canVote = isOpenReview(r) && isMember;
  const canConclude = isOpenReview(r) && (isMember || r.submitter === u);
  const canResubmit = r.status === '未通过' && r.submitter === u;
  const agree = r.opinions.filter(o => o[2] === '同意').length;
  const against = r.opinions.filter(o => o[2] === '反对').length;
  /* 被审用例内容：字段由查看者自选（默认关键字段），渲染上下文交给字段 cell 读取 */
  const caseInfo = reviewCaseRows(r, bucket);
  __revView = { id: id, bucket: bucket };
  __revCtx = {
    canVote,
    verdicts: Object.assign({}, r.caseVerdicts || {}, (__revPending && __revPending.id === id) ? __revPending.map : {})
  };
  __revPending = null;   /* 未提交的逐条结论已并入本次渲染，避免下次打开又把旧选择捞回来 */
  const caseBlock = reviewCaseBlockHtml(r, bucket, caseInfo);

  modal('审核详情 · ' + r.target, `
    <table class="detail-table">
      <tr><td>审核单号</td><td>${r.id}</td><td>审核范围</td><td>${r.scope}</td></tr>
      <tr><td>提交人</td><td>${r.submitter}</td><td>提交日期</td><td>${r.submitDate}</td></tr>
      <tr><td>审核期限</td><td>${r.deadline}</td><td>状态</td><td>${pill(r.status)}</td></tr>
      <tr><td>参会人员</td><td colspan="3">${r.participants.join('、') || '待组织（部门内/项目内相关人员）'}</td></tr>
      <tr><td>变更说明</td><td colspan="3">${r.note || '—'}</td></tr>
      <tr><td>表决进度</td><td colspan="3">同意 ${agree} / 反对 ${against}（已表决 ${r.opinions.length}/${total || '—'} 人）${r.resubmits ? `　已重新提交 ${r.resubmits} 次` : ''}</td></tr>
      <tr><td>审核结论</td><td colspan="3">${r.result || '待审议（少数服从多数）'}</td></tr>
      <tr><td>截止提醒</td><td colspan="3">${deadlineHint(r)}</td></tr>
    </table>
    ${caseBlock}
    <h4 style="margin:18px 0 8px">审核意见（会议记录）</h4>
    <table class="detail-table"><thead><tr><th>参会人</th><th>意见</th><th>表决</th></tr></thead>
    <tbody>${r.opinions.length ? r.opinions.map(o => `<tr><td>${o[0]}</td><td style="white-space:normal">${o[1]}</td><td>${pill(o[2], o[2] === '同意' ? 'success' : 'danger')}</td></tr>`).join('') : '<tr><td colspan="3" class="empty">尚未提交审核意见</td></tr>'}</tbody></table>
    ${canVote ? `
    <div class="form" style="margin-top:16px">
      <div class="field"><label>我的意见（${u}）</label><textarea id="voteNote" rows="2">${mine ? mine[1] : ''}</textarea></div>
      <div class="field"><label>表决（少数服从多数）</label><div class="multi">
        <label><input type="radio" name="vote" value="同意" ${mine && mine[2] === '同意' ? 'checked' : ''}> 同意</label>
        <label><input type="radio" name="vote" value="反对" ${mine && mine[2] === '反对' ? 'checked' : ''}> 反对</label>
      </div></div>
    </div>` : `<div class="hint" style="margin-top:14px">${isOpenReview(r) ? '当前登录用户不在本次审核参会范围内，仅可查看。' : '本次审核已出结论，流程已封闭。'}</div>`}
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">关闭</button>
      ${canVote ? `<button class="btn btn-primary" id="doVote">提交我的意见</button>` : ''}
      ${canConclude ? `<button class="btn btn-danger" id="conclude">结束审议并出结论</button>` : ''}
      ${canResubmit ? `<button class="btn btn-primary" id="resubmit">修改后重新提交审核</button>` : ''}
    </div>`);

  if (canVote) $('#doVote').onclick = () => {
    const note = $('#voteNote').value.trim();
    const vote = ($$('input[name=vote]').find(x => x.checked) || {}).value;
    if (!vote) { toast('请选择同意或反对'); return; }
    if (vote === '反对' && !note) { toast('表决为「反对」时必须填写意见（退回原因）'); return; }
    /* 逐条审核结论随意见一并保存 */
    const cv = {};
    $$('.cvsel').forEach(s => { if (s.value) cv[s.dataset.id] = s.value; });
    r.caseVerdicts = cv;
    if (mine) { mine[1] = note || '无意见'; mine[2] = vote; } else r.opinions.push([u, note || '无意见', vote]);
    const cvIds = Object.keys(cv);
    log('提交审核意见', `${r.id}｜${u}（${DB.currentRole}）｜${vote}｜${note || '无意见'}`
      + `${cvIds.length ? `｜逐条结论 ${cvIds.length} 条：${cvIds.map(id => `${id}=${cv[id]}`).join('、')}` : ''}`,
      '', { module: '审核', objType: '审核单', objId: r.id, changes: cvIds.map(id => ({ field: `逐条结论 · ${id}`, from: '（未表态）', to: cv[id] })) });
    save(); closeTopModal(); openReview(id, bucket); toast('意见已提交', 'success');
  };
  if (canConclude) $('#conclude').onclick = () => {
    if (!r.opinions.length) { toast('还没有任何审核意见，无法出结论'); return; }
    const pass = agree > against;
    r.status = pass ? '已通过' : '未通过';
    r.result = `同意 ${agree} / 反对 ${against}，${pass ? '审核通过' : '审核未通过，退回修改'}`;
    /* 出结论前同步逐条审核结论 */
    const cv = {};
    $$('.cvsel').forEach(s => { if (s.value) cv[s.dataset.id] = s.value; });
    if (Object.keys(cv).length) r.caseVerdicts = Object.assign({}, r.caseVerdicts || {}, cv);
    /* 逐条审核：pass 入库（按审批通过时间生成用例编号）；decline 或整体未通过 → 回退至发起人待办 */
    let passCnt = 0, declineCnt = 0;
    const passIds = [], declineIds = [];
    (r.caseIds || []).forEach(id => {
      const c = DB.stdCases.find(x => x.id === id);
      if (!c) return;
      const v = (r.caseVerdicts || {})[id];
      if (pass && v !== 'decline') {
        const newId = nextStdCaseId();
        c.historyLog = `${c.historyLog || ''}；${nowStr()} 模块用例审核通过（${r.id}），`
          + (isPendingCaseId(id) ? `生成正式用例编号 ${newId}（按审批通过时间生成，此前显示「待编号」）` : `用例编号 ${id} → ${newId}（按审批通过时间生成）`);
        c.id = newId;
        /* 用例编号变化：使「用例编号 → 用例」索引失效 */
        resetStdCaseIndex();
        /* 审核单内的用例编号与逐条结论同步为新编号，便于后续追溯 */
        const ci = (r.caseIds || []).indexOf(id);
        if (ci >= 0) r.caseIds[ci] = newId;
        if (r.caseVerdicts && r.caseVerdicts[id]) { r.caseVerdicts[newId] = r.caseVerdicts[id]; delete r.caseVerdicts[id]; }
        c.status = '正常';
        c.reviewStatus = `模块用例审核通过（${r.id}，${today()}）`;
        c.updateDate = today(); c.updater = DB.currentUser;
        c.returnReason = ''; c.returnDate = ''; c.returnTo = '';
        passCnt++;
        passIds.push(`${c.id}${isPendingCaseId(id) ? `（原待编号）` : ''}`);
      } else {
        c.status = '回退';
        c.returnReason = v === 'decline' ? `逐条审核 decline（${r.id}）：${r.result}` : `审核未通过（${r.id}）：${r.result}`;
        c.returnDate = today();
        c.returnTo = c.designer;
        c.historyLog = `${c.historyLog || ''}；${today()} 审核退回，待发起人修改后重新提交`;
        declineCnt++;
        declineIds.push(id);
      }
    });
    if (pass) {
      if (bucket === 'module') {
        const mod = DB.stdModules.find(m => m.name === (r.module || ''));
        if (mod) {
          if (r.type === '测试方案') mod.planReview = `模块用例审核通过（部门内，${today()}）`;
          else mod.caseReview = `模块用例审核通过（部门内，${today()}）`;
        }
      } else {
        const p = DB.products.find(x => x.model === r.product);
        if (p) p.reviewStatus = `产品用例审核通过（项目内，${today()}）`;
      }
      r.archivedAt = nowStr();
    } else if (bucket === 'module') {
      const mod = DB.stdModules.find(m => m.name === (r.module || ''));
      if (mod) mod.caseReview = `模块用例审核未通过（${today()}），退回修改`;
    } else {
      const p = DB.products.find(x => x.model === r.product);
      if (p) p.reviewStatus = '审核未通过，退回修改';
    }
    log('审核出结论', `${r.id}｜${r.result}｜参会 ${r.participants.join('、')}｜意见 ${r.opinions.length} 条`
      + `${passCnt ? `｜入库 ${passCnt} 条：${passIds.join('、')}` : ''}`
      + `${declineCnt ? `｜退回 ${declineCnt} 条：${declineIds.join('、')}` : ''}`,
      '', {
        module: '审核', objType: '审核单', objId: r.id,
        changes: [
          { field: '审核状态', from: '审核中', to: r.status },
          ...(passCnt ? [{ field: '逐条入库', from: '待审', to: `${passCnt} 条：${passIds.join('、')}` }] : []),
          ...(declineCnt ? [{ field: '逐条退回', from: '待审', to: `${declineCnt} 条：${declineIds.join('、')}` }] : [])
        ]
      });
    save(); closeTopModal(); renderReviews();
    toast(pass
      ? `审核已通过并归档${passCnt ? `，${passCnt} 条用例入库（编号按审批通过时间生成）` : ''}${declineCnt ? `，${declineCnt} 条 decline 已退回发起人` : ''}`
      : `审核未通过，${declineCnt ? `${declineCnt} 条用例已退回` : '已退回'}修改`, pass ? 'success' : 'error');
  };
  if (canResubmit) $('#resubmit').onclick = () => {
    r.status = '审核中';
    r.result = '';
    r.opinions = [];
    r.resubmits = (r.resubmits || 0) + 1;
    r.submitDate = today();
    log('重新提交审核', `${r.id}｜${r.target}｜第 ${r.resubmits} 次提交`);
    save(); closeTopModal(); renderReviews(); toast('已重新提交审核', 'success');
  };
};

/* ---------- 通用组件 ---------- */
function pager(total, page, pages) {
  if (pages <= 1) return '';
  return `<div class="pagination">
    <button class="btn btn-sm" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">上一页</button>
    <em>${page}</em> / <em>${pages}</em>
    <button class="btn btn-sm" ${page === pages ? 'disabled' : ''} data-page="${page + 1}">下一页</button>
    <span>共 ${total} 条</span></div>`;
}
function bindPager(cb) { $$('.pagination button[data-page]').forEach(b => b.onclick = () => cb(+b.dataset.page)); }
/* 分页 + 每页条数选择（默认 50 条，可调） */
function pagerFull(total, page, pages, size, sizeId, sizes) {
  const opts = sizes || [20, 50, 100, 200];
  return `<div class="pagination">
    <span class="page-size">每页 <select id="${sizeId}">${opts.map(n => `<option value="${n}" ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select> 条</span>
    ${pages <= 1 ? '' : `<button class="btn btn-sm" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">上一页</button>
      <em>${page}</em> / <em>${pages}</em>
      <button class="btn btn-sm" ${page === pages ? 'disabled' : ''} data-page="${page + 1}">下一页</button>`}
    <span>共 ${total} 条</span></div>`;
}
/* 弹窗关闭：先播放淡出/下移动画，动画结束后再移除节点（简洁不拖沓，200ms）。
   两个关键处理，避免"延迟移除"带来的副作用：
   1) 关闭瞬间把标记类 modal-backdrop 换成 modal-closing —— 原来按 $$('.modal-backdrop')
      取"最上层弹窗"的代码（如草稿页重绘）立即不会再命中正在关闭的弹窗；
   2) 移除内部元素的 id —— 避免与随后新开弹窗的同名 id（formOk / f_xxx 等）冲突。 */
function closeModalEl(el) {
  if (!el || el.__closing) return;
  el.__closing = true;
  el.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  el.className = 'modal-closing';
  setTimeout(() => el.remove(), 200);
}
function closeTopModal() {
  const b = $$('.modal-backdrop');
  if (b.length) closeModalEl(b[b.length - 1]);
  /* 弹窗内表格的重绘钩子在弹窗关闭后失效，避免列设置保存时写入已卸载的节点 */
  if (b.length <= 1) { window.__pickRedraw = null; window.__pickProdRedraw = null; window.__detailRedraw = null; }
}
function closeAllModals() {
  $$('.modal-backdrop').forEach(closeModalEl);
  window.__pickRedraw = null;
  window.__pickProdRedraw = null;
  window.__detailRedraw = null;
}
window.closeAllModals = closeAllModals;
/* ================= 通用下拉增强：原生 <select> → 关键字搜索下拉 =================
   渐进增强：保留原生 select（CSS 隐藏），既有逻辑（.value / .options / .onchange /
   .selectedIndex / 动态重写 options）全部照常工作；触发器上的文字与禁用态自动同步。 */
function sselLabelOf(sel) {
  if (sel.multiple) {
    /* 多选：不选 = 全部；选 1~2 项直接列出，更多时折叠为「A、B 等 N 项」 */
    const vals = Array.from(sel.selectedOptions || []).map(o => String(o.textContent).trim()).filter(Boolean);
    if (!vals.length) return sel.dataset.sselEmpty || '全部';
    if (vals.length <= 2) return vals.join('、');
    return vals.slice(0, 2).join('、') + ` 等 ${vals.length} 项`;
  }
  const o = sel.options[sel.selectedIndex];
  return o ? String(o.textContent).trim() : '请选择';
}
function sselSync(sel) {
  const wrap = sel.__sselWrap;
  if (!wrap) return;
  const t = wrap.querySelector('.ssel-text');
  if (t) t.textContent = sselLabelOf(sel);
  wrap.classList.toggle('ssel-off', !!sel.disabled);
  if (sel.multiple) {
    const wrap2 = wrap.querySelector('.ssel-picked');
    if (wrap2) {
      const n = (sel.selectedOptions || []).length;
      wrap2.textContent = n ? `已选 ${n} 项` : '';
    }
  }
  const panel = sel.__sselPanel || wrap.querySelector('.ssel-panel');
  if (panel && sel.disabled) { panel.style.display = 'none'; wrap.classList.remove('ssel-open'); }
}
/* 关闭所有下拉面板：面板已统一挂到 body，通过 __sselWrap 反查触发器同步箭头旋转态 */
function sselCloseAll(except) {
  $$('.ssel-panel').forEach(p => {
    if (p === except || p.style.display !== 'block' || !p.__sselWrap) return;
    p.style.display = 'none';
    /* 同步收起箭头旋转态，避免关闭后箭头仍朝上 */
    const w = p.__sselWrap;
    if (w) w.classList.remove('ssel-open');
  });
}
/* 页面重绘会移除触发器，但挂在 body 上的面板不随之移除：打开下拉时顺带清理孤儿面板，避免节点堆积 */
function sselCleanOrphans() {
  $$('.ssel-panel.ssel-float').forEach(p => {
    const w = p.__sselWrap;
    if (!w || !document.body.contains(w)) p.remove();
  });
}
function enhanceSelect(sel) {
  if (!sel || sel.tagName !== 'SELECT' || sel.__sselDone) return;
  if (sel.dataset && sel.dataset.noSsel) return;
  if (sel.closest && sel.closest('.ssel-panel')) return;
  const multi = !!sel.multiple;
  sel.__sselDone = true;
  const wrap = document.createElement('div');
  wrap.className = 'ssel ssel-inline ssel-fixed' + (multi ? ' ssel-multi' : '');
  wrap.innerHTML = '<div class="ssel-display"><span class="ssel-text"></span><span class="ssel-caret">▾</span></div>'
    + '<div class="ssel-panel" style="display:none"><div class="ssel-search"><span class="ssel-ico">🔍</span>'
    + '<input placeholder="输入关键字搜索"></div>'
    + (multi ? '<div class="ssel-actions"><span class="ssel-picked"></span>'
      + '<a data-mact="all">全选</a><a data-mact="clear">清空</a><a data-mact="done">完成</a></div>' : '')
    + '<div class="ssel-list"></div></div>';
  if (sel.style && sel.style.width) wrap.style.width = sel.style.width;
  sel.parentNode.insertBefore(wrap, sel.nextSibling);
  sel.classList.add('ssel-native');
  sel.__sselWrap = wrap;
  const disp = wrap.querySelector('.ssel-display');
  const panel = wrap.querySelector('.ssel-panel');
  const input = panel.querySelector('input');
  const list = panel.querySelector('.ssel-list');
  /* 面板统一挂到 body 并固定定位：不会被表格 / 弹窗等容器的 overflow 裁剪，
     也不会被后续行或固定表头遮住（位置由 open() 按触发器坐标计算） */
  panel.classList.add('ssel-float');
  panel.__sselWrap = wrap;
  sel.__sselPanel = panel;
  document.body.appendChild(panel);
  const fire = () => sel.dispatchEvent(new Event('change', { bubbles: true }));
  const draw = () => {
    const kw = input.value.trim().toLowerCase();
    const opts = Array.from(sel.options).filter(o => !kw || String(o.textContent).toLowerCase().indexOf(kw) >= 0);
    list.innerHTML = opts.length
      ? opts.map(o => `<div class="ssel-opt${o.selected ? ' active' : ''}" data-v="${encodeURIComponent(o.value)}">
          <span class="ssel-check">${o.selected ? '✓' : ''}</span>
          <span class="ssel-opt-main"><b>${o.textContent}</b></span></div>`).join('')
      : '<div class="empty" style="padding:12px">没有匹配项</div>';
    $$('.ssel-opt', list).forEach(el => el.onclick = ev => {
      ev.stopPropagation();
      if (multi) {
        /* 多选：点一下切换选中状态，面板保持展开，便于连续勾选多项 */
        const opt = Array.from(sel.options).find(o => o.value === decodeURIComponent(el.dataset.v));
        if (opt) opt.selected = !opt.selected;
        sselSync(sel);
        draw();
        fire();
        return;
      }
      sel.value = decodeURIComponent(el.dataset.v);
      panel.style.display = 'none';
      wrap.classList.remove('ssel-open');
      fire();
    });
  };
  const multiAct = action => {
    if (action === 'all') Array.from(sel.options).forEach(o => { o.selected = true; });
    else if (action === 'clear') Array.from(sel.options).forEach(o => { o.selected = false; });
    else { panel.style.display = 'none'; wrap.classList.remove('ssel-open'); return; }
    sselSync(sel);
    draw();
    fire();
  };
  const open = () => {
    if (sel.disabled) return;
    sselCleanOrphans();
    if (panel.parentNode !== document.body) document.body.appendChild(panel);
    sselCloseAll(panel);
    panel.style.display = 'block';
    wrap.classList.add('ssel-open');
    input.value = '';
    if (multi) $$('[data-mact]', panel).forEach(a => a.onclick = ev => { ev.stopPropagation(); multiAct(a.dataset.mact); });
    sselSync(sel);
    draw();
    /* fixed 定位：优先向下展开，空间不足向上；避免被表格 / 弹窗的溢出裁剪 */
    const r = disp.getBoundingClientRect();
    const pw = Math.min(Math.max(r.width, 220), Math.min(460, window.innerWidth - 24));
    panel.style.width = pw + 'px';
    panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 12)) + 'px';
    /* 选项列表高度按可用空间收敛：贴近视口上下边缘时选项不会被裁掉（超出部分列表内滚动） */
    list.style.maxHeight = '';
    const naturalH = panel.offsetHeight;
    const chrome = Math.max(0, naturalH - list.offsetHeight);
    const hasDown = r.bottom + 6 + naturalH <= window.innerHeight - 8;
    const space = (hasDown ? window.innerHeight - r.bottom - 20 : r.top - 20) - chrome;
    list.style.maxHeight = Math.max(96, Math.min(300, space)) + 'px';
    list.scrollTop = 0;
    const ph = panel.offsetHeight;
    /* 位置收敛：无论向上还是向下展开，面板整体都落在视口内（贴近边缘时同样不会被裁掉） */
    const rawTop = hasDown ? r.bottom + 6 : r.top - 6 - ph;
    panel.style.top = Math.max(8, Math.min(rawTop, Math.max(8, window.innerHeight - ph - 8))) + 'px';
    /* preventScroll 必加：聚焦搜索框会自动滚动容器，滚动事件会立刻把刚打开的下拉关掉 */
    input.focus({ preventScroll: true });
  };
  const close = () => { panel.style.display = 'none'; wrap.classList.remove('ssel-open'); };
  disp.onclick = ev => {
    ev.stopPropagation();
    panel.style.display === 'block' ? close() : open();
  };
  panel.onclick = ev => ev.stopPropagation();
  /* 面板内的滚轮只作用于选项列表：列表没滚动条、或已经滚到顶/底时，也要吃掉这次滚动，
     否则滚轮会转去滚外层页面 → 触发 scroll 收起逻辑，下拉被关掉。
     能滚的情况不拦截，交给浏览器原生滚动（保留惯性、平滑与滚动条同步）。 */
  panel.addEventListener('wheel', ev => {
    const px = ev.deltaMode === 1 ? ev.deltaY * 18 : ev.deltaMode === 2 ? ev.deltaY * 320 : ev.deltaY;
    const max = list.scrollHeight - list.clientHeight;
    const atTop = list.scrollTop <= 0, atBottom = list.scrollTop >= max - 1;
    if (max <= 0 || (px < 0 && atTop) || (px > 0 && atBottom)) ev.preventDefault();
  }, { passive: false });
  input.oninput = draw;
  input.onkeydown = ev => {
    if (ev.key === 'Escape') close();
    else if (ev.key === 'Enter') { const f = $('.ssel-opt', list); if (f) f.click(); }
  };
  sel.addEventListener('change', () => sselSync(sel));
  /* 代码直接赋值 .value 时同步触发器文字（例如 el.value = '' 重置筛选）。
     多选下拉的 value 读写都按数组处理（字符串入参视为单选，便于脚本与旧逻辑沿用）。 */
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get() {
        if (!multi) return desc.get.call(this);
        return Array.from(this.selectedOptions || []).map(o => o.value).filter(v => v !== '');
      },
      set(v) {
        if (!multi) { desc.set.call(this, v); sselSync(this); return; }
        const arr = asList(v);
        Array.from(this.options).forEach(o => { o.selected = arr.indexOf(o.value) >= 0; });
        sselSync(this);
      }
    });
  } catch (e) { }
  sselSync(sel);
}
function enhanceSelects(root) {
  const scope = root || document;
  if (scope.tagName === 'SELECT') { enhanceSelect(scope); return; }
  if (!scope.querySelectorAll) return;
  Array.from(scope.querySelectorAll('select:not(.ssel-native)')).forEach(enhanceSelect);
}
/* 动态内容（弹窗 / 表格重绘 / 表单联动）自动增强 + 触发器状态同步 */
function initSelectEnhancer() {
  if (window.__sselObserver) return;
  const obs = new MutationObserver(muts => {
    let need = false;
    const syncs = new Set();
    muts.forEach(m => {
      if (m.type === 'childList') {
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'SELECT' || (n.querySelector && n.querySelector('select'))) need = true;
        });
        if (m.target.tagName === 'SELECT' && m.target.__sselWrap) syncs.add(m.target);
      } else if (m.type === 'attributes' && m.target.tagName === 'SELECT' && m.target.__sselWrap) {
        syncs.add(m.target);
      }
    });
    syncs.forEach(s => sselSync(s));
    if (need) setTimeout(() => enhanceSelects(document), 0);
  });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  window.__sselObserver = obs;
  enhanceSelects(document);
  /* 点击面板内的选项 / 搜索框 / 列表滚动条时，别被全局收起逻辑误伤：
     记录这一轮点击是否「按在面板里」，按在面板里就放过本次全局收起。
     典型场景是拖列表滚动条时松手位置略微偏出面板 —— mousedown 与 mouseup 落在不同元素上，
     click 会派发到它们的共同祖先（页面），若不做这层判断，滚动条一拖就把下拉关了。 */
  let downInPanel = false;
  document.addEventListener('mousedown', ev => {
    const t = ev.target;
    downInPanel = !!(t && t.nodeType === 1 && t.closest && t.closest('.ssel-panel'));
  }, true);
  document.addEventListener('click', () => { if (downInPanel) return; sselCloseAll(); });
  window.addEventListener('resize', () => sselCloseAll());
  /* 页面 / 弹窗滚动时收起下拉（面板是 fixed 定位，滚动后会与触发器错位）。
     但下拉自身选项列表的滚动必须放行：滚轮滚动列表、以及鼠标拖动列表的竖向滚动条，
     都会在 .ssel-list 上派发 scroll 事件（scroll 不冒泡，却会被这里的捕获监听收到），
     若一并收起，列表靠下的选项就永远选不到。 */
  window.addEventListener('scroll', ev => {
    const t = ev.target;
    if (t && t.nodeType === 1 && t.closest && t.closest('.ssel-panel')) return;
    sselCloseAll();
  }, true);
}

function modal(title, body) {
  const div = document.createElement('div');
  div.className = 'modal-backdrop';
  div.innerHTML = `<div class="modal"><div class="modal-header"><span class="modal-title">${title}</span><button class="modal-close" title="关闭">&times;</button></div><div class="modal-body">${body}</div></div>`;
  document.body.appendChild(div);
  /* 关闭方式仅限弹窗内的按钮：右上角 × 、取消 / 关闭 / 确定等显式按钮。
     遮罩（空白处）不绑定任何点击关闭逻辑，避免误点丢失正在填写的内容；
     遮罩仍是全屏覆盖层，会正常拦截对下层页面的点击。 */
  $('.modal-close', div).onclick = () => closeModalEl(div);
  /* 弹窗内的下拉框统一增强为关键字搜索下拉 */
  enhanceSelects(div);
  /* 弹窗内表格同样做列宽适配 */
  fitAllTables(div);
}
/* 条件字段显隐统一入口（分支类型 / 自动化标志 / 用例来源 / dependsOn 联动共用）：
   隐藏立即生效（不占位），展示时播放一次「淡入 + 从上方 6px 下滑归位」（CSS .reveal-in），
   让被触发展示的字段「显现」出来而不是凭空出现。
   两个关键处理：
   1) 只有「原本处于隐藏」才播动画 —— 弹窗刚打开时的首次同步不会让整个表单动一下；
   2) 重复触发（是 → 否 → 是）靠「移除类 → 强制回流 → 加回类」重放，
      否则同一个类还在元素上，浏览器不会重新播放动画，第二次展开就看不到效果了。 */
function toggleReveal(box, on) {
  if (!box) return;
  if (!on) {
    box.style.display = 'none';
    box.classList.remove('reveal-in');
    return;
  }
  const wasHidden = box.style.display === 'none' || getComputedStyle(box).display === 'none';
  box.style.display = '';
  if (!wasHidden) return;
  box.classList.remove('reveal-in');
  void box.offsetWidth; /* 强制回流，让同名动画重新播放 */
  box.classList.add('reveal-in');
  box.addEventListener('animationend', () => box.classList.remove('reveal-in'), { once: true });
}
function formModal(title, fields, onSubmit, hint, opts) {
  opts = opts || {};
  const body = fields.map(f => {
    const id = 'f_' + f.key;
    const small = f.hint ? `<small style="color:#8a9aab">${f.hint}</small>` : '';
    if (f.type === 'textarea') return `<div class="field"><label>${f.label}</label><textarea id="${id}" rows="3">${f.value || ''}</textarea>${small}</div>`;
    if (f.type === 'select') return `<div class="field"><label>${f.label}</label><select id="${id}">${f.options.map(o => `<option value="${o}" ${o === f.value ? 'selected' : ''}>${o}</option>`).join('')}</select>${small}</div>`;
    if (f.type === 'multi') return `<div class="field"><label>${f.label}</label><div class="multi">${f.options.map(o => `<label><input type="checkbox" name="${id}" value="${o}" ${(f.value || []).includes(o) ? 'checked' : ''}> ${o}</label>`).join('')}</div>${small}</div>`;
    if (f.type === 'number') return `<div class="field"><label>${f.label}</label><input id="${id}" type="number" value="${f.value == null ? '' : f.value}">${small}</div>`;
    /* 只读字段（系统生成值，如执行页新增用例的临时编号）：仅展示，不可编辑 */
    if (f.readonly) return `<div class="field"><label>${f.label}</label><input id="${id}" value="${f.value || ''}" readonly style="background:#f4f6f8;color:#6b7c8f">${small}</div>`;
    /* 可自定义填写：输入框 + 候选列表（datalist），既可选已有项也可直接输入新值 */
    if (f.list && f.list.length) {
      return `<div class="field"><label>${f.label}</label>`
        + `<input id="${id}" list="${id}_list" value="${f.value || ''}" placeholder="${f.placeholder || ''}">${small}`
        + `<datalist id="${id}_list">${f.list.map(o => `<option value="${o}"></option>`).join('')}</datalist></div>`;
    }
    return `<div class="field"><label>${f.label}</label><input id="${id}" value="${f.value || ''}">${small}</div>`;
  }).join('');
  /* opts.actions：表单级「多种提交方式」按钮（如执行页修改用例的「提交不移除原用例」） */
  const extraActs = (opts.actions || []).map(a => `<button class="btn ${a.cls || 'btn-ghost'}" id="formAct_${a.id}" title="${a.title || ''}">${a.text}</button>`).join('');
  modal(title, `${hint ? `<div class="hint">${hint}</div>` : ''}<div class="form">${body}</div>
    <div class="form-actions">
      <button class="btn btn-ghost" id="formCancel">取消</button>
      ${opts.extraActions || ''}
      ${extraActs}
      <button class="btn btn-primary" id="formOk">${opts.okText || '提交'}</button>
    </div>`);
  /* 字段联动：dependsOn = { key, equals } —— 条件不满足时该字段整体隐藏并清空，条件满足后再展示
     （用于「用例来源 = 市场问题」才可填写市场反馈 BUG / 市场反馈时间） */
  const depFields = fields.filter(f => f.dependsOn);
  const depOn = f => {
    const src = $('#' + 'f_' + f.dependsOn.key);
    return !!src && String(src.value) === String(f.dependsOn.equals);
  };
  const syncDeps = () => {
    depFields.forEach(f => {
      const ctrl = $('#' + 'f_' + f.key);
      if (!ctrl) return;
      const on = depOn(f);
      ctrl.disabled = !on;
      if (!on) ctrl.value = '';
      /* 展示时带动效：条件刚满足，字段「显现」出来而不是凭空出现 */
      toggleReveal(ctrl.closest('.field'), on);
    });
  };
  depFields.forEach(f => {
    const s = $('#' + 'f_' + f.dependsOn.key);
    if (s) s.onchange = syncDeps;
  });
  if (depFields.length) syncDeps();
  const submit = act => {
    /* 条件必填：required = { key, equals } —— 条件成立时该字段不能为空 */
    const bad = fields.filter(f => f.required).find(f => {
      const src = $('#' + 'f_' + f.required.key);
      const ctrl = $('#' + 'f_' + f.key);
      return src && ctrl && String(src.value) === String(f.required.equals) && !String(ctrl.value || '').trim();
    });
    if (bad) { toast(`${bad.label} 为必填项`); return; }
    const v = {};
    fields.forEach(f => {
      const id = 'f_' + f.key;
      v[f.key] = f.type === 'multi' ? $$(`input[name="${id}"]:checked`).map(i => i.value) : ($('#' + id) ? $('#' + id).value : '');
    });
    /* act：点击的是哪个提交按钮（'ok' = 主按钮；其余为 opts.actions 里的 id），便于一表多提交方式 */
    if (onSubmit(v, act) !== false) closeTopModal();
  };
  $('#formCancel').onclick = () => closeTopModal();
  $('#formOk').onclick = () => submit('ok');
  (opts.actions || []).forEach(a => {
    const b = $('#formAct_' + a.id);
    if (b) b.onclick = () => submit(a.id);
  });
  const first = $$('.modal-body .form input, .modal-body .form select, .modal-body .form textarea')[0];
  if (first) { first.focus(); first.onkeydown = e => { if (e.key === 'Enter' && first.tagName !== 'TEXTAREA') submit(); }; }
}
function confirmModal(title, html, onOk, okText) {
  modal(title, `${html}<div class="form-actions"><button class="btn btn-primary" id="cfmOk">${okText || '确定'}</button><button class="btn" id="cfmCancel" style="background:#eee;color:#333">取消</button></div>`);
  $('#cfmCancel').onclick = () => closeTopModal();
  $('#cfmOk').onclick = onOk;
}
window.closeTopModal = closeTopModal;
/* ================= 操作日志（全量审计视图：按模块 / 人员 / 关键字 / 日期筛选，可导出存档） ================= */
function logEsc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
/* 待办页「操作日志」卡片：最近 N 条（与全量面板同口径，点「查看全部」进入筛选 / 导出） */
function todoLogRows(n) {
  return (DB.logs || []).slice(0, n || 20).map(l => `<tr>
      <td style="white-space:nowrap">${logEsc(l.time)}</td>
      <td style="white-space:nowrap">${logEsc(l.user)}</td>
      <td style="white-space:nowrap">${logEsc(logModuleOfRecord(l))}</td>
      <td style="white-space:nowrap">${logEsc(l.action)}${(l.count || 1) > 1 ? ` <span class="chip chip-warn" title="合并窗口内的连续修改">×${l.count}</span>` : ''}</td>
      <td style="white-space:normal">${logEsc(l.detail || '—')}</td>
    </tr>`).join('');
}
function logModules() { return Array.from(new Set((DB.logs || []).map(logModuleOfRecord))).filter(Boolean).sort(); }
function logUsers() { return Array.from(new Set((DB.logs || []).map(l => l.user).filter(Boolean))).sort(); }
/* 日志筛选：模块 / 操作人 / 日期区间 / 关键字（动作、对象、编号、字段变更文本都参与匹配） */
function filterLogs(q) {
  const f = q || {};
  const kw = String(f.kw || '').trim().toLowerCase();
  return (DB.logs || []).filter(l => {
    if (f.module && logModuleOfRecord(l) !== f.module) return false;
    if (f.user && l.user !== f.user) return false;
    if (f.from && String(l.time || '').slice(0, 10) < f.from) return false;
    if (f.to && String(l.time || '').slice(0, 10) > f.to) return false;
    if (!kw) return true;
    return [l.time, l.user, l.role, logModuleOfRecord(l), l.action, l.objType, l.objId, l.detail, l.taskId]
      .join(' ').toLowerCase().indexOf(kw) >= 0;
  });
}
window.openMyLogs = function () {
  if (!state.logQuery) state.logQuery = { kw: '', module: '', user: '', from: '', to: '', page: 1, size: 50 };
  const q = state.logQuery;
  modal('操作日志（全模块 · 可追溯）', `
    
    <div class="toolbar" style="box-shadow:none;margin-bottom:10px">
      <div><label>关键字</label><input id="lgKw" placeholder="动作 / 对象编号 / 字段 / 说明" value="${logEsc(q.kw)}" style="min-width:190px"></div>
      <div><label>模块</label><select id="lgMod"><option value="">全部模块</option>${logModules().map(m => `<option ${q.module === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div><label>操作人</label><select id="lgUser"><option value="">全部人员</option>${logUsers().map(u => `<option ${q.user === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div><label>起始</label><input id="lgFrom" type="date" value="${logEsc(q.from)}"></div>
      <div><label>截止</label><input id="lgTo" type="date" value="${logEsc(q.to)}"></div>
      <div><label>每页</label><select id="lgSize">${[20, 50, 100, 200].map(n => `<option ${q.size === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <button class="btn btn-ghost btn-sm" id="lgSearch">查询</button>
      <button class="btn btn-ghost btn-sm" id="lgReset">重置</button>
      <button class="btn btn-primary btn-sm" id="lgExport">导出 Excel</button>
    </div>
    <div id="lgList"></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeTopModal()">关闭</button></div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1320px, 96vw)';
  const draw = () => {
    const list = filterLogs(q);
    const pages = Math.max(1, Math.ceil(list.length / q.size));
    if (q.page > pages) q.page = pages;
    const pageList = list.slice((q.page - 1) * q.size, q.page * q.size);
    const rows = pageList.map(l => `<tr>
        <td style="white-space:nowrap">${logEsc(l.time)}</td>
        <td style="white-space:nowrap">${logEsc(l.user)}${l.role ? `<span class="chip" style="margin-left:4px">${logEsc(l.role)}</span>` : ''}</td>
        <td style="white-space:nowrap">${logEsc(logModuleOfRecord(l))}</td>
        <td style="white-space:nowrap">${logEsc(l.action)}${(l.count || 1) > 1 ? ` <span class="chip chip-warn" title="合并窗口内的连续修改">×${l.count}</span>` : ''}</td>
        <td style="white-space:nowrap">${logEsc(l.objType || '—')}${l.objId ? `<div class="hint" style="margin:0">${logEsc(briefLogText(l.objId, 26))}</div>` : ''}</td>
        <td style="white-space:normal">${logEsc(l.detail || '—')}</td>
      </tr>`).join('');
    $('#lgList').innerHTML = `
      <div class="hint" style="margin:0 0 6px">命中 <b>${list.length}</b> 条 / 共 ${(DB.logs || []).length} 条</div>
      <div class="table-wrap" style="max-height:58vh">
        <table><thead><tr><th style="width:150px">时间</th><th style="width:130px">操作人</th><th style="width:86px">模块</th><th style="width:170px">操作</th><th style="width:150px">对象</th><th>变更明细 / 说明</th></tr></thead>
        <tbody>${rows || empty(6)}</tbody></table>
      </div>
      ${pager(list.length, q.page, pages)}`;
    /* 只绑弹窗内的分页按钮（bindPager 是全局绑定，会误伤页面背后的分页） */
    $$('#lgList .pagination button[data-page]').forEach(b => b.onclick = () => { q.page = +b.dataset.page; draw(); });
    fitAllTables($('#lgList'));
    /* 审计视图以「看清变更明细」为先：截断放宽到 4 行（悬停仍可看全文） */
    $$('#lgList .cell-clamp').forEach(el => { el.style.webkitLineClamp = '4'; el.style.maxHeight = 'none'; });
  };
  const readQuery = () => {
    q.kw = $('#lgKw').value; q.module = $('#lgMod').value; q.user = $('#lgUser').value;
    q.from = $('#lgFrom').value; q.to = $('#lgTo').value; q.size = +$('#lgSize').value || 50; q.page = 1;
  };
  $('#lgSearch').onclick = () => { readQuery(); draw(); };
  $('#lgKw').onkeydown = e => { if (e.key === 'Enter') { readQuery(); draw(); } };
  $('#lgMod').onchange = () => { readQuery(); draw(); };
  $('#lgUser').onchange = () => { readQuery(); draw(); };
  $('#lgSize').onchange = () => { readQuery(); draw(); };
  $('#lgReset').onclick = () => {
    state.logQuery = { kw: '', module: '', user: '', from: '', to: '', page: 1, size: 50 };
    closeTopModal(); openMyLogs();
  };
  $('#lgExport').onclick = () => {
    const list = filterLogs(q);
    if (!list.length) { toast('当前筛选条件下没有日志'); return; }
    const rows = [['时间', '操作人', '角色', '模块', '操作', '对象类型', '对象编号', '关联任务', '变更明细 / 说明', '合并次数']]
      .concat(list.map(l => [
        l.time, l.user, l.role || '', logModuleOfRecord(l), l.action, l.objType || '', l.objId || '',
        l.taskId || '', l.detail || '', l.count || 1
      ]));
    downloadXlsx(`操作日志_${ymd()}.xlsx`, [{ name: '操作日志', rows }]);
    log('导出操作日志', `筛选条件 关键字「${q.kw || '—'}」模块「${q.module || '全部'}」人员「${q.user || '全部'}」`
      + `日期 ${q.from || '不限'} ~ ${q.to || '不限'}｜导出 ${list.length} 条`, '', { module: '导入导出' });
    toast(`已导出 ${list.length} 条操作日志`, 'success');
  };
  draw();
};

window.toast = function (msg, type) {
  const div = document.createElement('div');
  div.className = 'toast' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
  div.textContent = msg;
  document.body.appendChild(div);
  /* 停留后先播放上移淡出，再移除，避免提示"啪"地消失 */
  setTimeout(() => div.classList.add('toast-out'), 1800);
  setTimeout(() => div.remove(), 2020);
};
window.tip = function (msg) { toast(msg, 'error'); };

/* ================= 我的待办辅助 ================= */
function myExportRequests() {
  return (DB.exportRequests || []).filter(r => r.status === '审批中' && (r.approvers || []).includes(DB.currentUser));
}

/* ================= 数据统计 ================= */
function statBars(pairs, opts) {
  const o = opts || {};
  let list = pairs.slice();
  if (o.sort) list.sort((a, b) => (o.sort === 'asc' ? a[1] - b[1] : b[1] - a[1]));
  if (o.hideZero) list = list.filter(x => (+x[1] || 0) > 0);
  if (o.limit) list = list.slice(0, o.limit);
  const max = Math.max(1, ...list.map(x => +x[1] || 0));
  const total = list.reduce((n, x) => n + (+x[1] || 0), 0);
  return list.map(([label, val, cls]) => {
    const v = +val || 0;
    const share = o.share && total ? `<span style="color:#9aa8b6">　${(v * 100 / total).toFixed(1)}%</span>` : '';
    return `<div class="stat-row">
      <div class="stat-label" title="${label}">${label}</div>
      <div class="stat-bar ${cls || ''}"><span style="width:${Math.round(v * 100 / max)}%"></span></div>
      <div class="stat-val"><b>${v}</b>${o.suffix || ''}${share}</div>
    </div>`;
  }).join('') || '<div class="empty" style="padding:14px">暂无数据</div>';
}
function statCols(pairs, note) {
  const max = Math.max(1, ...pairs.map(x => +x[1] || 0));
  return `<div class="stat-cols">${pairs.map(([label, val]) => `
    <div class="stat-col" title="${label}：${val}">
      <div class="col-val">${val}</div>
      <div class="col-bar" style="height:${Math.max(3, Math.round((+val || 0) * 100 / max))}%"></div>
      <div class="col-label">${label}</div>
    </div>`).join('')}</div>${note ? `<div class="stat-note">${note}</div>` : ''}`;
}
function groupPairs(list, keyFn, opts) {
  const m = new Map();
  list.forEach(x => { const k = keyFn(x); if (k == null || k === '') return; m.set(k, (m.get(k) || 0) + 1); });
  let arr = Array.from(m.entries());
  const o = opts || {};
  arr.sort((a, b) => (o.asc ? a[0].localeCompare(b[0]) : b[1] - a[1]));
  return arr;
}
function kpiCard(num, title, sub, cls) {
  return `<div class="kpi ${cls || ''}"><div class="kpi-num">${num}</div><div class="kpi-title">${title}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
}
function monthOf(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})/); return m ? `${m[1]}-${m[2]}` : ''; }
function pctStr(a, b) { return b ? `${(a * 100 / b).toFixed(1)}%` : '—'; }
function canViewStats() { return can('page.stats'); }
/* ================= 数据统计：统一时间区间 =================
   统计页顶部选择区间后，模块用例库 / 产品用例库 / 增长情况 / 执行统计 / 库间关联等卡片
   均按该区间过滤数据（核心指标为全库口径，不受区间影响）。 */
const STATS_RANGES = [
  { id: 'all', label: '全部时间' },
  { id: '7d', label: '近 7 天', days: 7 },
  { id: '30d', label: '近 30 天', days: 30 },
  { id: '90d', label: '近 90 天', days: 90 },
  { id: '180d', label: '近半年', days: 180 },
  { id: '365d', label: '近一年', days: 365 },
  { id: 'year', label: '本年度' },
  { id: 'custom', label: '自定义区间' }
];
function statsRange() {
  const st = state.statsRange || {};
  const preset = st.preset || 'all';
  let from = '', to = '';
  if (preset === 'custom') { from = st.from || ''; to = st.to || ''; }
  else if (preset === 'year') { from = today().slice(0, 4) + '-01-01'; to = today(); }
  else {
    const def = STATS_RANGES.find(r => r.id === preset);
    if (def && def.days) { from = addDays(-(def.days - 1)); to = today(); }
  }
  return { preset, from, to, active: !!(from || to) };
}
/* 单个日期是否落在区间内；无日期值在指定区间下一律不计入 */
function inStatsRange(v) {
  const r = statsRange();
  if (!r.active) return true;
  const d = String(v || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return (!r.from || d >= r.from) && (!r.to || d <= r.to);
}
/* 多个日期字段「任一命中」：模块用例按设计日期（新增）/ 更新日期（修订）双口径 */
function anyInStatsRange(...vals) {
  const r = statsRange();
  if (!r.active) return true;
  return vals.some(v => inStatsRange(v));
}
function statsRangeLabel() {
  const r = statsRange();
  if (!r.active) return '全部时间';
  return `${r.from || '…'} ~ ${r.to || '…'}`;
}
window.setStatsRange = function (preset) {
  state.statsRange = { preset: preset || 'all', from: '', to: '' };
  if (preset === 'custom') {
    const cur = statsRange();
    state.statsRange.from = cur.from || addDays(-29);
    state.statsRange.to = cur.to || today();
  }
  renderStats();
  toast(`统计区间：${statsRangeLabel()}`, 'success');
};
window.setStatsRangeDate = function (which, val) {
  const cur = statsRange();
  state.statsRange = { preset: 'custom', from: cur.from, to: cur.to };
  state.statsRange[which] = val;
  renderStats();
};
/* 执行任务的时间口径：结束时间 → 创建日期 startDate → 执行任务编号（ZXRW+YYYYMMDD+序号）中的日期 */
function execDateOf(e) {
  const fin = String((e && e.finishedAt) || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fin)) return fin;
  const st = String((e && e.startDate) || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(st)) return st;
  const m = String((e && e.execId) || '').match(/^ZXRW(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function renderStats() {
  resetStdCaseIndex();
  if (!canViewStats()) {
    $('#page').innerHTML = `<div class="panel" style="border-top:1px solid var(--border)">
      <div class="empty" style="padding:52px 20px">
        <p style="font-size:14px">「数据统计」仅一级、二级及以上权限人员可查看。</p>
        <p class="hint">当前账号：${DB.currentUser} · 角色：${DB.currentRole}（${permLabels(roleDef(DB.currentRole).perms) || '无'}）</p>
        <button class="btn btn-ghost" onclick="logoutConfirm()">退出登录</button>
      </div></div>`;
    return;
  }
  const rg = statsRange();
  $('#page').innerHTML = `
    <div class="toolbar">
      <div class="actions" style="margin-left:auto">
        <button class="btn btn-ghost" onclick="renderStats();toast('统计数据已刷新')">刷新</button>
        ${can('export') ? '<button class="btn btn-primary" onclick="exportStatsSummary()">导出统计汇总</button>' : ''}
      </div>
    </div>
    <div class="toolbar">
      <div><label>统计区间</label><select id="statsRange">
        ${STATS_RANGES.map(r => `<option value="${r.id}" ${rg.preset === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}
      </select></div>
      <div><label>起始日期</label><input type="date" id="statsFrom" value="${rg.from}"></div>
      <div><label>截止日期</label><input type="date" id="statsTo" value="${rg.to}"></div>
      <span class="chip chip-info" title="当前统计区间">区间：${statsRangeLabel()}</span>
      <button class="btn btn-ghost" id="statsRangeReset">全部时间</button>
    </div>
    ${statsKpi()}
    <div class="stat-grid">
      ${statsCase()}
      ${statsProdCase()}
      ${statsStdGrowth()}
      ${statsProdGrowth()}
      ${statsTask()}
      ${statsExec()}
      ${statsReuse()}
      ${statsLineage()}
    </div>`;
  $('#statsRange').onchange = ev => setStatsRange(ev.target.value);
  $('#statsFrom').onchange = ev => setStatsRangeDate('from', ev.target.value);
  $('#statsTo').onchange = ev => setStatsRangeDate('to', ev.target.value);
  $('#statsRangeReset').onclick = () => setStatsRange('all');
}
/* 数据统计：产品用例统计的产品范围（'' = 全部产品） */
function statsProdScope() {
  const all = DB.products || [];
  const sel = state.statsProdModel;
  const list = sel ? all.filter(p => p.model === sel) : all;
  const rows = [];
  list.forEach(p => prodCaseRows(p).forEach(r => rows.push(Object.assign({}, r, { __model: p.model }))));
  return { list, rows, sel };
}
window.setStatsProd = function (model) {
  state.statsProdModel = model || '';
  renderStats();
  toast(model ? `已切换产品：${model}` : '已切换为全部产品', 'success');
};

/* ---- 核心指标 ---- */
function statsKpi() {
  const std = DB.stdCases || [];
  const normal = std.filter(c => c.status === '正常').length;
  const pending = std.filter(c => c.status === '新增' || c.status === '回退').length;
  const off = std.filter(c => c.status === '停用').length;
  const auto = std.filter(c => c.autoFlag === '是').length;
  const prodRows = (DB.products || []).reduce((n, p) => n + prodCaseRows(p).length, 0);
  const tasks = DB.tasks || [];
  const execs = DB.execTasks || [];
  const finishedTasks = tasks.filter(t => t.finished === '是').length;
  const sum = execs.reduce((a, e) => {
    const s = execStats(e);
    a.planned += execPlanned(e); a.actual += s.actual; a.passed += s.passed; a.failed += s.failed; a.blocked += s.blocked; a.notRun += s.notRun; a.diverged += (e.diverged || 0);
    return a;
  }, { planned: 0, actual: 0, passed: 0, failed: 0, blocked: 0, notRun: 0, diverged: 0 });
  const bugs = DB.bugs || [];
  const market = DB.marketBugs || [];
  const resolved = bugs.filter(b => /已解决|已关闭/.test(b.status || '')).length;
  const mods = DB.stdModules || [];
  const ownerCovered = mods.filter(m => m.owner).length;
  return `
    <div class="panel">
      <div class="panel-header"><h2 class="panel-title">核心指标</h2>
        <span class="hint" style="margin:0">用例库 ${DB.products.length} 个产品 · ${mods.length} 个功能模块 · ${tasks.length} 个测试任务</span></div>
      <div class="kpi-grid">
        ${kpiCard(std.length, '模块用例总数', `正常 ${normal} · 待审核 ${pending} · 停用 ${off}`, 'k-teal')}
        ${kpiCard(`${pctStr(auto, std.length)}`, '自动化用例覆盖率', `${auto} / ${std.length} 条已自动化`, auto ? 'k-blue' : 'k-gray')}
        ${kpiCard(prodRows, '产品用例总数', `${DB.products.length} 个产品（引用 + 专属增补）`, 'k-blue')}
        ${kpiCard(execs.length, '执行任务数', `${tasks.length} 个任务下（已归档 ${finishedTasks}）`, 'k-blue')}
        ${kpiCard(sum.planned, '计划执行用例', `实际执行 ${sum.actual} 条（${pctStr(sum.actual, sum.planned)}）`, 'k-amber')}
        ${kpiCard(`${pctStr(sum.passed, sum.planned)}`, '用例通过率', `通过 ${sum.passed} · 失败 ${sum.failed}`, sum.failed ? 'k-amber' : 'k-teal')}
        ${kpiCard(sum.failed, '失败 / 阻塞用例', `失败 ${sum.failed} · 阻塞 ${sum.blocked} · 未执行 ${sum.notRun}`, sum.failed || sum.blocked ? 'k-red' : 'k-gray')}
        ${kpiCard(sum.diverged, '发散（临时）用例', `${execs.length} 个执行任务累计`, 'k-gray')}
        ${kpiCard(bugs.length, '缺陷总数', `已解决 ${resolved} · 处理中 ${bugs.length - resolved}`, bugs.length ? 'k-red' : 'k-gray')}
        ${kpiCard(market.length, '市场问题', `待反推 ${market.filter(m => /待/.test(m.status || '')).length} 条`, market.length ? 'k-amber' : 'k-gray')}
        ${kpiCard(`${pctStr(ownerCovered, mods.length)}`, '模块责任人覆盖', `${ownerCovered} / ${mods.length} 个模块已指定`, ownerCovered === mods.length ? 'k-teal' : 'k-amber')}
        ${kpiCard(DB.deptMembers.length, '测试部成员', `${(DB.handovers || []).length} 条权限移交记录`, 'k-gray')}
      </div>
    </div>`;
}

/* ---- 用例统计（整行宽卡片，三列条形图，无横向滚动） ---- */
function statsCase() {
  const stdAll = DB.stdCases || [];
  const std = stdAll.filter(c => anyInStatsRange(c.designDate, c.updateDate));
  const byDomain = groupPairs(std, c => stdDomainOf(c));
  const byLevel = groupPairs(std, c => c.level || '—', { asc: true });
  const byStatus = groupPairs(std, c => c.status || '—');
  const byBranch = groupPairs(std, c => c.branch || '—');
  const byType = groupPairs(std, c => c.testType || '—');
  const bySource = groupPairs(std, c => c.source || '—');
  const byModule = groupPairs(std, c => c.module || '—').slice(0, 10);
  const autoTool = groupPairs(std.filter(c => c.autoFlag === '是'), c => c.autoTool || '—');
  const statusCls = s => s === '正常' ? '' : s === '停用' ? 'b-gray' : s === '回退' ? 'b-red' : 'b-blue';
  return `
    <div class="panel wide">
      <div class="panel-header"><h2 class="panel-title">模块用例库统计</h2>
        <span class="hint" style="margin:0">统计范围：区间 <b>${statsRangeLabel()}</b> 内 ${std.length} 条（全库 ${stdAll.length} 条）</span></div>
      <div class="stat-cols-area c3">
        <div class="stat-col-fill">
          <div class="stat-sec"><b>用例领域</b>${statBars(byDomain, { share: true })}</div>
          <div class="stat-sec"><b>用例等级</b>${statBars(byLevel, { share: true })}</div>
          <div class="stat-sec"><b>用例状态</b>${statBars(byStatus.map(([k, v]) => [k, v, statusCls(k)]), { share: true })}
            <div class="stat-note">待审核 = 新增 + 回退，需推进审核入库</div></div>
        </div>
        <div class="stat-col-fill">
          <div class="stat-sec"><b>分支类型</b>${statBars(byBranch, { share: true })}</div>
          <div class="stat-sec"><b>测试类型</b>${statBars(byType, { share: true })}</div>
          <div class="stat-sec"><b>用例来源</b>${statBars(bySource, { share: true })}</div>
        </div>
        <div class="stat-col-fill">
          <div class="stat-sec"><b>模块用例数 Top 10</b>${statBars(byModule, { share: true })}</div>
          <div class="stat-sec"><b>自动化工具分布</b>（自动化 ${std.filter(c => c.autoFlag === '是').length} 条）
            ${autoTool.length ? statBars(autoTool, { share: true }) : '<div class="stat-note">暂无用例标记为自动化</div>'}</div>
        </div>
      </div>
    </div>`;
}

/* ---- 用例复用与引用 ---- */
function statsReuse() {
  const std = DB.stdCases || [];
  const reuseTop = std.map(c => [c.id, stdRefProductsOf(c).length]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const noRef = std.filter(c => stdRefProductsOf(c).length === 0).length;
  const byDesigner = groupPairs(std, c => c.designer || '—').slice(0, 8);
  return `
    <div class="panel">
      <div class="panel-header"><h2 class="panel-title">用例复用与引用</h2>
        <span class="hint" style="margin:0">未被产品引用 ${noRef} 条</span></div>
      <div class="stat-sec"><b>被引用次数 Top 8</b>
        ${reuseTop.length ? statBars(reuseTop, { suffix: ' 次' }) : '<div class="stat-note">暂无用例被产品用例库引用</div>'}</div>
      <div class="stat-sec"><b>设计者用例数 Top 8</b>${statBars(byDesigner)}</div>
      <div class="stat-note">复用率高说明模块用例通用性好；长期未被引用的用例可评估是否停用</div>
    </div>`;
}

/* ---- 模块用例库增长情况（与产品用例库分开统计） ---- */
function statsStdGrowth() {
  const stdAll = DB.stdCases || [];
  const std = stdAll.filter(c => anyInStatsRange(c.designDate, c.updateDate));
  const byCreate = new Map(), byUpdate = new Map();
  std.forEach(c => {
    const mc = monthOf(c.designDate); if (mc) byCreate.set(mc, (byCreate.get(mc) || 0) + 1);
    const mu = monthOf(c.updateDate); if (mu) byUpdate.set(mu, (byUpdate.get(mu) || 0) + 1);
  });
  const months = Array.from(new Set(Array.from(byCreate.keys()).concat(Array.from(byUpdate.keys())))).sort();
  const createPairs = months.map(m => [m.slice(2), byCreate.get(m) || 0]);
  const updatePairs = months.map(m => [m.slice(2), byUpdate.get(m) || 0]);
  let acc = 0;
  const rows = months.map(m => {
    const add = byCreate.get(m) || 0;
    acc += add;
    return `<tr><td>${m}</td><td><b>+${add}</b></td><td>${acc}</td><td>${byUpdate.get(m) || 0}</td></tr>`;
  }).join('');
  const newest = months.slice(-3).reduce((n, m) => n + (byCreate.get(m) || 0), 0);
  return `
    <div class="panel wide">
      <div class="panel-header"><h2 class="panel-title">模块用例库增长情况</h2>
        <span class="hint" style="margin:0">统计范围：区间 <b>${statsRangeLabel()}</b> 内 ${std.length} 条（全库 ${stdAll.length} 条）</span></div>
      <div class="stat-cols-area c2">
        <div class="stat-col-fill">
          <div class="stat-sec"><b>每月新增用例</b>${statCols(createPairs, `近 3 个月新增 ${newest} 条；累计 ${std.length} 条`)}</div>
          <div class="stat-sec"><b>每月用例修订</b>${statCols(updatePairs, '修订包含用例内容更新与审核入库带来的变更')}</div>
        </div>
        <div class="stat-sec"><b>增长明细</b>
          <div class="table-wrap" style="max-height:400px">
            <table><colgroup><col style="width:28%"><col style="width:24%"><col style="width:24%"><col style="width:24%"></colgroup>
            <thead><tr><th>月份</th><th>新增</th><th>累计</th><th>修订</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="empty">暂无数据</td></tr>'}</tbody></table>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---- 产品用例库统计（支持选择不同产品） ---- */
function statsProdCase() {
  const scope = statsProdScope();
  const sel = scope.sel;
  const rowsAll = scope.rows;
  const rows = rowsAll.filter(r => inStatsRange(r.date));
  const refs = rows.filter(r => r.source === '引用模块库');
  const bySource = groupPairs(rows, r => r.source || '—');
  const byModule = groupPairs(rows, r => r.module || '—').slice(0, 10);
  const byLevel = groupPairs(rows, r => r.level || '—', { asc: true });
  const byType = groupPairs(rows, r => r.testType || '—');
  const byBranch = groupPairs(rows, r => r.branch || '—');
  const byModel = groupPairs(rows, r => r.__model || '—');
  const srcCls = s => (s === '产品专属增补' ? 'b-amber' : s === '引用产品用例' ? 'b-blue' : '');
  const selector = `<select onchange="setStatsProd(this.value)">
      <option value="" ${sel ? '' : 'selected'}>全部产品（${(DB.products || []).length} 个）</option>
      ${(DB.products || []).map(p => `<option value="${p.model}" ${sel === p.model ? 'selected' : ''}>${p.model}（${prodCaseRows(p).length} 条）</option>`).join('')}
    </select>`;
  return `
    <div class="panel wide">
      <div class="panel-header"><h2 class="panel-title">产品用例库统计</h2>
        <div class="actions">
          <span class="hint" style="margin:0">统计范围：</span>${selector}
          <span class="chip chip-info">区间：${statsRangeLabel()}</span>
          <span class="hint" style="margin:0">区间内 ${rows.length} 条（全量 ${rowsAll.length} 条）</span>
        </div>
      </div>
      <div class="stat-kv" style="margin-bottom:4px">
        <div>产品用例总数<b>${rows.length}</b></div>
        <div>引用模块库<b>${refs.length}</b></div>
        <div>引用产品用例<b>${rows.filter(r => r.source === '引用产品用例').length}</b></div>
        <div>产品专属增补<b>${rows.filter(r => r.source === '产品专属增补').length}</b></div>
      </div>
      <div class="stat-cols-area c3">
        <div class="stat-col-fill">
          <div class="stat-sec"><b>用例来源</b>${statBars(bySource.map(([k, v]) => [k, v, srcCls(k)]), { share: true })}</div>
          <div class="stat-sec"><b>用例等级</b>${statBars(byLevel, { share: true })}</div>
        </div>
        <div class="stat-col-fill">
          <div class="stat-sec"><b>功能模块 Top 10</b>${statBars(byModule, { share: true })}</div>
          <div class="stat-sec"><b>分支类型</b>${statBars(byBranch, { share: true })}</div>
        </div>
        <div class="stat-col-fill">
          <div class="stat-sec"><b>测试类型</b>${statBars(byType, { share: true })}</div>
          <div class="stat-sec"><b>${sel ? '该产品' : '各产品'}用例量</b>${statBars(byModel, { share: !sel })}</div>
        </div>
      </div>
    </div>`;
}

/* ---- 产品用例库增长情况（跟随所选产品） ---- */
function statsProdGrowth() {
  const { rows: rowsAll, sel } = statsProdScope();
  const rows = rowsAll.filter(r => inStatsRange(r.date));
  const byMonth = new Map();
  rows.forEach(r => { const m = monthOf(r.date); if (m) byMonth.set(m, (byMonth.get(m) || 0) + 1); });
  const months = Array.from(byMonth.keys()).sort();
  const pairs = months.map(m => [m.slice(2), byMonth.get(m) || 0]);
  let acc = 0;
  const tableRows = months.map(m => {
    const add = byMonth.get(m) || 0;
    acc += add;
    return `<tr><td>${m}</td><td><b>+${add}</b></td><td>${acc}</td></tr>`;
  }).join('');
  const undated = rows.filter(r => !monthOf(r.date)).length;
  return `
    <div class="panel wide">
      <div class="panel-header"><h2 class="panel-title">产品用例库增长情况</h2>
        <span class="hint" style="margin:0">统计范围：<b>${sel || '全部产品'}</b> · 区间 <b>${statsRangeLabel()}</b>　区间内 ${rows.length} 条（全量 ${rowsAll.length} 条）${undated ? `（${undated} 条无日期未计入）` : ''}</span></div>
      <div class="stat-cols-area c2">
        <div class="stat-sec"><b>每月产品用例新增</b>
          ${months.length ? statCols(pairs, `累计 ${acc} 条（${sel || '全部产品'}）`) : '<div class="stat-note">暂无可统计的产品用例日期</div>'}</div>
        <div class="stat-sec"><b>增长明细</b>
          <div class="table-wrap" style="max-height:400px">
            <table><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup>
            <thead><tr><th>月份</th><th>新增</th><th>累计</th></tr></thead>
            <tbody>${tableRows || '<tr><td colspan="3" class="empty">暂无数据</td></tr>'}</tbody></table>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---- 任务统计 ---- */
function statsTask() {
  const tasks = DB.tasks || [];
  const execs = DB.execTasks || [];
  const byType = groupPairs(tasks, t => t.type || '—');
  const byState = [['进行中', tasks.filter(t => t.finished !== '是').length], ['已完结（归档）', tasks.filter(t => t.finished === '是').length]];
  const byLead = groupPairs(tasks, t => t.testLead || '—');
  const scaleRows = tasks.map(t => {
    const es = execs.filter(e => e.taskId === t.id);
    const sum = es.reduce((a, e) => {
      const s = execStats(e);
      a.planned += execPlanned(e); a.actual += s.actual; a.passed += s.passed; a.failed += s.failed;
      return a;
    }, { planned: 0, actual: 0, passed: 0, failed: 0 });
    return { t, es, sum };
  }).sort((a, b) => b.sum.planned - a.sum.planned);
  return `
    <div class="panel wide">
      <div class="panel-header"><h2 class="panel-title">任务统计</h2>
        <span class="hint" style="margin:0">共 ${tasks.length} 个测试任务 · ${execs.length} 个执行任务</span></div>
      <div class="stat-cols-area c3">
        <div class="stat-sec"><b>任务类型</b>${statBars(byType, { share: true })}</div>
        <div class="stat-sec"><b>任务状态</b>${statBars(byState.map(([k, v]) => [k, v, k === '已完结（归档）' ? 'b-gray' : 'b-blue']), { share: true })}
          <div class="stat-note">已完结任务可在「归档任务」页按年份追溯</div></div>
        <div class="stat-sec"><b>测试主负责人任务数</b>${statBars(byLead)}</div>
      </div>
      <div class="stat-sec"><b>任务规模与执行情况</b></div>
      <div class="table-wrap" style="max-height:260px">
        <table><colgroup><col style="width:30%"><col style="width:11%"><col style="width:11%"><col style="width:10%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:11%"></colgroup>
        <thead><tr><th>任务</th><th>类型</th><th>状态</th><th>执行任务</th><th>计划</th><th>实际</th><th>通过</th><th>通过率</th></tr></thead>
        <tbody>${scaleRows.map(({ t, es, sum }) => `<tr>
          <td>${t.name}</td><td>${t.type}</td>
          <td>${t.finished === '是' ? pill('已完结', 'gray') : pill('进行中', 'info')}</td>
          <td>${es.length}</td><td>${sum.planned}</td><td>${sum.actual}</td><td>${sum.passed}</td>
          <td>${pctStr(sum.passed, sum.planned)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">暂无数据</td></tr>'}</tbody></table>
      </div>
    </div>`;
}

/* ---- 执行统计 ---- */
function statsExec() {
  const execsAll = DB.execTasks || [];
  const execs = execsAll.filter(e => inStatsRange(execDateOf(e)));
  const allRows = [];
  execs.forEach(e => execCaseRows(e).forEach(r => allRows.push({ e, r })));
  const norm = v => {
    const s = String(v || '').trim();
    if (s === 'Pass' || s === '通过') return '通过';
    if (s === 'Fail' || s === '失败') return '失败';
    if (s === '阻塞') return '阻塞';
    return '未执行';
  };
  const byResult = groupPairs(allRows, x => norm(x.r.result));
  const resultCls = k => k === '通过' ? '' : k === '失败' ? 'b-red' : k === '阻塞' ? 'b-amber' : 'b-gray';
  const order = ['通过', '失败', '阻塞', '未执行'];
  const resultPairs = order.map(k => [k, (byResult.find(x => x[0] === k) || [k, 0])[1], resultCls(k)]);
  /* 按执行人 */
  const people = new Map();
  allRows.forEach(({ r }) => {
    const k = r.executor || '未分配';
    if (!people.has(k)) people.set(k, { planned: 0, actual: 0, passed: 0, failed: 0, blocked: 0, notRun: 0 });
    const o = people.get(k);
    o.planned++;
    const n = norm(r.result);
    if (n === '未执行') o.notRun++;
    else { o.actual++; if (n === '通过') o.passed++; else if (n === '失败') o.failed++; else o.blocked++; }
  });
  /* 按产品型号 */
  const models = new Map();
  execs.forEach(e => {
    const k = e.model || '—';
    if (!models.has(k)) models.set(k, { planned: 0, actual: 0, passed: 0, failed: 0, execs: 0 });
    const o = models.get(k);
    const s = execStats(e);
    o.execs++; o.planned += execPlanned(e); o.actual += s.actual; o.passed += s.passed; o.failed += s.failed;
  });
  const unassigned = allRows.filter(x => !x.r.executor || x.r.executor === '未分配').length;
  const diverged = execs.reduce((n, e) => n + (e.diverged || 0), 0);
  return `
    <div class="panel wide">
      <div class="panel-header"><h2 class="panel-title">执行统计</h2>
        <span class="hint" style="margin:0">区间 <b>${statsRangeLabel()}</b> 内 ${execs.length} 个执行任务（全部 ${execsAll.length} 个）· 用例 ${allRows.length} 条</span></div>
      <div class="stat-cols-area c2">
        <div class="stat-sec"><b>执行结果分布</b>${statBars(resultPairs, { share: true })}
          <div class="stat-note">执行完成率：${pctStr(resultPairs[0][1] + resultPairs[1][1] + resultPairs[2][1], allRows.length)}
            　通过率（占已执行）：${pctStr(resultPairs[0][1], resultPairs[0][1] + resultPairs[1][1] + resultPairs[2][1])}
            　发散用例：${diverged}　未分配执行人：${unassigned}</div>
        </div>
        <div class="stat-sec"><b>按产品型号统计</b>
          <div class="table-wrap" style="max-height:230px">
            <table><colgroup><col style="width:26%"><col style="width:16%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:19%"></colgroup>
            <thead><tr><th>产品型号</th><th>执行任务</th><th>计划</th><th>实际</th><th>通过</th><th>通过率</th></tr></thead>
            <tbody>${Array.from(models.entries()).map(([model, o]) => `<tr>
              <td>${model}</td><td>${o.execs}</td><td>${o.planned}</td><td>${o.actual}</td><td>${o.passed}</td>
              <td>${pctStr(o.passed, o.planned)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">暂无数据</td></tr>'}</tbody></table>
          </div>
        </div>
      </div>
      <div class="stat-sec"><b>按执行人统计</b></div>
      <div class="table-wrap" style="max-height:260px">
        <table><colgroup><col style="width:20%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:10%"><col style="width:11%"><col style="width:14%"></colgroup>
        <thead><tr><th>执行人</th><th>计划</th><th>实际</th><th>通过</th><th>失败</th><th>阻塞</th><th>未执行</th><th>通过率</th><th>执行进度</th></tr></thead>
        <tbody>${Array.from(people.entries()).sort((a, b) => b[1].planned - a[1].planned).map(([name, o]) => `<tr>
          <td><b>${name}</b>${name === '未分配' ? ' <span class="chip chip-warn">待指派</span>' : ''}</td>
          <td>${o.planned}</td><td>${o.actual}</td><td>${o.passed}</td><td>${o.failed}</td><td>${o.blocked}</td><td>${o.notRun}</td>
          <td>${pctStr(o.passed, o.planned)}</td>
          <td><span class="prog"><span style="width:${o.planned ? Math.round(o.actual * 100 / o.planned) : 0}%"></span></span> ${o.planned ? Math.round(o.actual * 100 / o.planned) : 0}%</td>
        </tr>`).join('') || '<tr><td colspan="9" class="empty">暂无数据</td></tr>'}</tbody></table>
      </div>
    </div>`;
}

/* ---- 库间关联统计 ---- */
function statsLineage() {
  const prods = DB.products || [];
  /* 关联数据同样按统计区间过滤：产品用例行的引用 / 增补日期、回流记录的提交日期、停用用例的停用日期 */
  let refs = 0, prodRefCnt = 0, added = 0;
  const byModel = [];
  prods.forEach(p => {
    const rows = prodCaseRows(p).filter(r => inStatsRange(r.date));
    refs += rows.filter(r => r.source === '引用模块库').length;
    prodRefCnt += rows.filter(r => r.source === '引用产品用例').length;
    added += rows.filter(r => r.source === '产品专属增补').length;
    byModel.push([p.model, rows.length]);
  });
  const links = (DB.lineageProdToStd || []).filter(l => inStatsRange(l.submitDate));
  const byStatus = groupPairs(links, l => l.status || '—');
  const offCases = (DB.stdCases || []).filter(c => c.status === '停用' && anyInStatsRange(c.disableDate, c.updateDate, c.designDate)).length;
  const modelBars = byModel.filter(x => x[1] > 0);
  return `
    <div class="panel">
      <div class="panel-header"><h2 class="panel-title">库间关联与复用</h2>
        </div>
      <div class="stat-kv">
        <div>引用模块库用例<b>${refs}</b></div>
        <div>引用产品用例<b>${prodRefCnt}</b></div>
        <div>产品专属增补<b>${added}</b></div>
        <div>引用占比<b>${pctStr(refs, refs + added + prodRefCnt)}</b></div>
        <div>模块库停用用例<b>${offCases}</b></div>
      </div>
      <div class="stat-cols-area c2" style="margin-top:14px">
        <div class="stat-sec"><b>各产品用例构成（引用 + 增补）</b>${modelBars.length ? statBars(modelBars, { share: true }) : '<div class="stat-note">该区间内暂无用例数据</div>'}</div>
        <div class="stat-sec"><b>产品用例回流状态</b>${links.length ? statBars(byStatus, { share: true }) : '<div class="stat-note">暂无回流记录</div>'}</div>
      </div>
    </div>`;
}

/* ---- 导出（统一 Excel，CSV 导出已下线） ---- */

/* ================= Excel（xlsx）导入导出 =================
   统一使用 Excel 格式，避免 CSV 在换行 / 逗号 / 引号场景下内容错位。
   模板：模块用例库与产品用例库各一套（含「用例数据」与「填写说明」两个工作表）。 */
async function downloadXlsx(name, sheets) {
  if (!window.XLSX_LITE) { toast('Excel 组件未加载，请刷新页面后重试', 'error'); return; }
  const blob = await XLSX_LITE.write(sheets);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/* Excel 日期序列号 → YYYY-MM-DD（其它形式原样返回） */
function excelDateText(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return s;
}
/* 多值文本拆分（支持「、」逗号 分号 竖线 斜杠）。
   注意：不按空格拆分——产品型号本身可能含空格（如「USR-G780 V2」），空格分隔多型号请改用「、」或逗号 */
function splitList(s) {
  return String(s == null ? '' : s).split(MODEL_SEP).map(x => x.trim()).filter(Boolean);
}
/* 产品专属增补的下一个序号（取已有最大序号 +1，避免删除后撞号） */
function nextAddedSeq(p) {
  let max = 0;
  (p.added || []).forEach(a => { const m = String(a.id || '').match(/-A(\d+)$/); if (m) max = Math.max(max, +m[1]); });
  return max + 1;
}
/* 表头规范化：去空格与括号内容、斜杠统一，便于列名轻微差异也能对上 */
function normHeader(s) {
  return String(s == null ? '' : s)
    .replace(/[\s　]/g, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[／]/g, '/')
    .toLowerCase();
}
/* 按模板列定义映射表头 → 列下标 */
function mapHeaders(headerRow, cols) {
  const map = new Map();
  cols.forEach(c => map.set(normHeader(c[0]), c[1]));
  /* 常见别名兼容 */
  const alias = {
    '用例编号': 'id', '编号': 'id', '产品用例编号': 'id', 'testid': 'id',
    '详细概述': 'steps', '操作步骤': 'steps', '详细概述/操作步骤': 'steps', '测试步骤': 'steps',
    '预期结果': 'expect', '预期结果/测试标准': 'expect', '测试标准': 'expect',
    '适用产品': 'refProducts', '适用产品型号': 'refProducts', '产品型号': 'refProducts',
    '模块': 'module', '功能模块': 'module', '概述': 'summary', '用例概述': 'summary',
    '前置': 'pre', '前置条件': 'pre', '输入': 'input', '输入数据': 'input',
    '等级': 'level', '用例等级': 'level', '来源': 'source', '用例来源': 'source',
    '测试项目': 'testProject', '功能点': 'functionPoint', '测试点': 'testPoint',
    '手动测试时间': 'minutes', '手动测试时间(min)': 'minutes', '自动化标志': 'autoFlag',
    '自动化工具': 'autoTool', '自动化测试时间': 'autoTime', '市场反馈bug': 'marketBug', '市场反馈时间': 'marketBugDate'
  };
  Object.keys(alias).forEach(k => { const nk = normHeader(k); if (!map.has(nk)) map.set(nk, alias[k]); });
  const idx = {};
  (headerRow || []).forEach((h, i) => {
    const k = map.get(normHeader(h));
    if (k && idx[k] == null) idx[k] = i;
  });
  return idx;
}
function xlsxRowsFrom(cols, list, mapper) {
  const rows = [cols.map(f => f.label)];
  list.forEach(item => rows.push(cols.map(f => {
    const v = mapper ? mapper(f, item) : (f.get ? f.get(item) : item[f.key]);
    return v == null ? '' : String(v).replace(/<[^>]*>/g, '');
  })));
  return rows;
}

/* ---------- 导入模板列定义（列名 / 字段 / 必填 / 说明 / 示例） ---------- */
const STD_EXCEL_COLS = [
  ['功能模块', 'module', '必填', '可填已有模块，也可填写新模块名称（导入后自动纳入模块划分表）', '指示灯'],
  ['用例领域', 'domain', '', '硬件 / 固件 / 上位机 / 软件（手工填写）；留空时按功能模块领域推导', '固件'],
  ['分支类型', 'branch', '', '产品通用 / 指定产品；留空按「产品通用」', '产品通用'],
  ['适用产品型号', 'refProducts', '指定产品时必填', '多个型号用「、」或逗号分隔；产品通用可留空', ''],
  ['用例等级', 'level', '', 'L1 / L2 / L3，留空按 L3', 'L3'],
  ['用例来源', 'source', '', '需求 / 设计 / 市场问题 / BUG 反推 / 测试发散 / 测试任务 / 其他，留空按「需求」', '需求'],
  ['测试类型', 'testType', '', '功能 / 易用性 / 兼容性 / 性能 / 可靠性 / 安全测试，留空按「功能测试」', '功能测试'],
  ['测试项目', 'testProject', '', '留空默认取功能模块名称', ''],
  ['功能点', 'functionPoint', '', '分析维度，留空取功能模块名称', '电源状态指示灯'],
  ['测试点', 'testPoint', '', '留空按「人机交互」', '人机交互'],
  ['用例概述', 'summary', '必填', '用例的简要描述', '设备上电指示灯常亮'],
  ['前置条件', 'pre', '', '支持多行（单元格内换行）', 'EUT 正常供电'],
  ['详细概述 / 操作步骤', 'steps', '', '支持多行（单元格内换行）', '1.设备上电；2.观察 POW 指示灯'],
  ['输入数据', 'input', '', '留空按「无」', '无'],
  ['预期结果 / 测试标准', 'expect', '', '支持多行', 'POW 指示灯绿色常亮'],
  ['备注', 'remark', '', '留空按「无」', '无'],
  ['手动测试时间(min)', 'minutes', '', '数字', '5'],
  ['自动化标志', 'autoFlag', '', '是 / 否，留空按「否」', '否'],
  ['自动化工具', 'autoTool', '', '自动化标志为「是」时填写', ''],
  ['自动化测试时间(min)', 'autoTime', '', '自动化标志为「是」时填写', ''],
  ['市场反馈 BUG', 'marketBug', '', '用例来源为「市场问题」时填写', ''],
  ['市场反馈时间', 'marketBugDate', '', 'YYYY-MM-DD', '']
];
const PROD_EXCEL_COLS = [
  ['产品用例编号', 'id', '', '可留空；留空时按「产品型号-A序号」自动生成产品专属增补编号', ''],
  ['功能模块', 'module', '必填', '可填已有模块，也可填写新模块名称（导入后自动纳入模块划分表）', '低功耗休眠'],
  ['用例领域', 'domain', '', '硬件 / 固件 / 上位机 / 软件（手工填写）；留空时按功能模块领域推导', '固件'],
  ['用例来源', 'caseSource', '', '需求 / 设计 / 市场问题 / BUG 反推 / 测试发散 / 测试任务 / 其他；留空按「需求」；'
    + '仅「市场问题」时才带入市场反馈 BUG 与市场反馈时间', '需求'],
  ['测试类型', 'testType', '', '留空按「功能测试」', '功能测试'],
  ['用例概述', 'summary', '必填', '用例的简要描述', '休眠电流 ≤ 50uA'],
  ['功能点', 'functionPoint', '', '留空取功能模块名称', '休眠电流'],
  ['测试点', 'testPoint', '', '留空按「功能逻辑」', '功能逻辑'],
  ['用例等级', 'level', '', 'L1 / L2 / L3，留空按 L3', 'L2'],
  ['前置条件', 'pre', '', '支持多行', 'EUT 进入休眠模式'],
  ['操作步骤', 'steps', '', '支持多行', '1.进入休眠；2.测量电流'],
  ['输入数据', 'input', '', '留空按「无」', '无'],
  ['预期结果', 'expect', '', '支持多行', '电流 ≤ 50uA'],
  ['备注', 'remark', '', '留空按「无」', '无'],
  ['测试项目', 'testProject', '', '留空取功能模块名称', ''],
  ['手动测试时间(min)', 'minutes', '', '数字', '10'],
  ['自动化标志', 'autoFlag', '', '是 / 否，留空按「否」', '否'],
  ['自动化工具', 'autoTool', '', '自动化标志为「是」时填写', ''],
  ['自动化测试时间(min)', 'autoTime', '', '自动化标志为「是」时填写', ''],
  ['市场反馈 BUG', 'marketBug', '', '市场问题单号 / BUG 编号', ''],
  ['市场反馈时间', 'marketBugDate', '', 'YYYY-MM-DD', '']
];
function templateSheets(cols, sheetName, note) {
  return [
    {
      name: sheetName, rows: [[`${note}（请从第 3 行开始填写数据，示例行可直接删除）`],
        cols.map(c => c[0]), cols.map(c => c[4] == null ? '' : c[4])]
    },
    {
      name: '填写说明', rows: [['列名', '是否必填', '填写说明'], ...cols.map(c => [c[0], c[2] || '', c[3] || ''])]
    }
  ];
}
window.downloadStdTemplate = async function () {
  await downloadXlsx(`模块用例导入模板_${ymd()}.xlsx`, templateSheets(STD_EXCEL_COLS, '模块用例', '模块用例导入模板'));
  toast('模板已下载：请按「填写说明」填写后使用「导入用例」上传', 'success');
};
window.downloadProdTemplate = async function () {
  await downloadXlsx(`产品用例导入模板_${ymd()}.xlsx`, templateSheets(PROD_EXCEL_COLS, '产品用例', '产品专属增补用例导入模板'));
  toast('模板已下载：请按「填写说明」填写后使用「导入 Excel」上传', 'success');
};

/* ---------- 模块用例：Excel 行 → 编写页草稿行 ---------- */
function draftRowsFromExcel(rows) {
  const res = { rows: [], errors: [], skipped: 0 };
  if (!rows || rows.length < 2) { res.errors.push('文件内容为空：至少需要表头行与一行数据'); return res; }
  /* 模板第 1 行为说明、第 2 行为表头；若用户删除说明行也能识别 */
  let headerAt = -1;
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    const idx = mapHeaders(rows[i], STD_EXCEL_COLS);
    if (idx.module != null) { headerAt = i; break; }
  }
  if (headerAt < 0) { res.errors.push('未识别到表头：请使用平台提供的导入模板（第 2 行为列名行）'); return res; }
  const idx = mapHeaders(rows[headerAt], STD_EXCEL_COLS);
  rows.slice(headerAt + 1).forEach((r, i) => {
    const lineNo = headerAt + i + 2;
    const val = k => (idx[k] == null ? '' : String(r[idx[k]] == null ? '' : r[idx[k]]).trim());
    if (!r.some(v => String(v == null ? '' : v).trim() !== '')) return;   /* 整行为空则跳过 */
    const moduleName = val('module'), summary = val('summary');
    if (!moduleName || !summary) { res.skipped++; res.errors.push(`第 ${lineNo} 行：功能模块与用例概述为必填，已跳过`); return; }
    const branch = normBranch(val('branch') || '产品通用');
    const products = branch === '指定产品' ? splitList(val('refProducts')) : [];
    if (branch === '指定产品' && !products.length) { res.skipped++; res.errors.push(`第 ${lineNo} 行：分支类型为「指定产品」时必须填写适用产品型号，已跳过`); return; }
    const autoOn = /^(是|y|yes|true|1)$/i.test(val('autoFlag'));
    /* 用例来源：仅「市场问题」才带入市场反馈 BUG 与市场反馈时间（与表单联动规则一致） */
    const src = val('source') || '需求';
    res.rows.push({
      module: moduleName, branch,
      /* 用例领域：模板中填写优先，留空按功能模块领域推导（收敛到四个选项内） */
      domain: normDomain(val('domain'), normDomain((DB.stdModules.find(m => m.name === moduleName) || {}).domain, '固件')),
      refProducts: products.join('、'), level: val('level') || 'L3',
      source: src, testType: val('testType') || '功能测试',
      testProject: val('testProject'), functionPoint: val('functionPoint') || moduleName,
      testPoint: val('testPoint') || '人机交互', summary,
      pre: val('pre'), steps: val('steps'), input: val('input') || '无',
      expect: val('expect'), remark: val('remark') || '无', minutes: val('minutes'),
      autoFlag: autoOn ? '是' : '否',
      autoTool: autoOn ? (val('autoTool') || '—') : '—',
      autoTime: autoOn ? (val('autoTime') || '—') : '—',
      marketBug: src === '市场问题' ? val('marketBug') : '',
      marketBugDate: src === '市场问题' ? excelDateText(val('marketBugDate')) : ''
    });
  });
  return res;
}

/* ---------- 产品用例：Excel 行 → 产品专属增补用例 ---------- */
function importProdRowsFromExcel(rows, model) {
  const p = DB.products.find(x => x.model === model) || DB.products[state.prodIndex];
  const res = { total: 0, added: 0, skipped: 0, errors: [], ids: [] };
  if (!p) { res.errors.push('未找到目标产品'); return res; }
  if (!rows || rows.length < 2) { res.errors.push('文件内容为空：至少需要表头行与一行数据'); return res; }
  let headerAt = -1;
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    const idx = mapHeaders(rows[i], PROD_EXCEL_COLS);
    if (idx.module != null) { headerAt = i; break; }
  }
  if (headerAt < 0) { res.errors.push('未识别到表头：请使用平台提供的产品用例导入模板'); return res; }
  const idx = mapHeaders(rows[headerAt], PROD_EXCEL_COLS);
  const usedIds = new Set(prodCaseRows(p).map(r => r.id).concat((p.added || []).map(a => a.id)));
  const seen = new Set();
  rows.slice(headerAt + 1).forEach((r, i) => {
    const lineNo = headerAt + i + 2;
    const val = k => (idx[k] == null ? '' : String(r[idx[k]] == null ? '' : r[idx[k]]).trim());
    if (!r.some(v => String(v == null ? '' : v).trim() !== '')) return;
    res.total++;
    const moduleName = val('module'), summary = val('summary');
    if (!moduleName || !summary) { res.skipped++; res.errors.push(`第 ${lineNo} 行：功能模块与用例概述为必填，已跳过`); return; }
    if (seen.has(summary + '|' + moduleName) || (p.added || []).some(a => a.summary === summary && a.module === moduleName)) {
      res.skipped++; res.errors.push(`第 ${lineNo} 行：该产品已存在相同模块与用例概述的专属增补用例，已跳过`); return;
    }
    /* 编号：有编号则沿用（需唯一），无编号统一按产品专属增补编号生成 */
    let id = val('id');
    if (id) {
      if (usedIds.has(id)) { res.skipped++; res.errors.push(`第 ${lineNo} 行：产品用例编号「${id}」已存在，已跳过`); return; }
    } else {
      let seq = nextAddedSeq(p) + res.added;
      id = prodCaseNo(p.model, 'A' + String(seq).padStart(2, '0'));
      while (usedIds.has(id)) { seq++; id = prodCaseNo(p.model, 'A' + String(seq).padStart(2, '0')); }
    }
    usedIds.add(id);
    seen.add(summary + '|' + moduleName);
    ensureModuleExists(moduleName, '固件', '产品用例 Excel 导入');
    const autoOn = /^(是|y|yes|true|1)$/i.test(val('autoFlag'));
    /* 用例来源：仅「市场问题」才带入市场反馈 BUG 与市场反馈时间（与表单联动规则一致） */
    const src = val('caseSource') || val('source') || '需求';
    const marketOn = src === MARKET_SOURCE;
    p.added.push({
      id, module: moduleName, domain: normDomain(val('domain'), normDomain((DB.stdModules.find(m => m.name === moduleName) || {}).domain, '固件')),
      summary, level: val('level') || 'L3', caseSource: src, date: today(),
      reviewer: DB.currentUser, feedback: '待回流确认',
      pre: val('pre'), steps: val('steps'), input: val('input') || '无',
      expect: val('expect'), remark: val('remark') || '无',
      testType: val('testType') || '功能测试',
      functionPoint: val('functionPoint') || moduleName,
      testPoint: val('testPoint') || '功能逻辑',
      testProject: val('testProject') || moduleName, minutes: val('minutes'),
      autoFlag: autoOn ? '是' : '否',
      autoTool: autoOn ? (val('autoTool') || '—') : '—',
      autoTime: autoOn ? (val('autoTime') || '—') : '—',
      autoUpdatedAt: autoOn ? today() : '—',
      bugCount: 0, bugIds: [], bugId: '—',
      marketBug: marketOn ? val('marketBug') : '',
      marketBugDate: marketOn ? excelDateText(val('marketBugDate')) : '',
      fromExcel: true
    });
    res.added++; res.ids.push(id);
  });
  if (res.added) {
    if (String(p.reviewStatus || '').indexOf('审核通过') < 0) p.reviewStatus = '待发起产品用例审核';
    p.planDate = today();
    log('导入产品用例（Excel）', `${p.model}｜导入 ${res.added} 条专属增补用例（跳过 ${res.skipped} 条）｜${res.ids.slice(0, 5).join('、')}${res.ids.length > 5 ? ' …' : ''}`);
    save();
  }
  return res;
}
/* 产品用例库：导出 Excel（model 省略时导出当前产品） */
/* 产品用例导出 Excel：ids 传入时只导出这些产品用例编号（申请时锁定的集合），
   审批通过后由申请人导出时使用，避免审批期间产品用例增减导致条数与审批不一致 */
window.exportProdXlsx = async function (model, ids) {
  const p = DB.products.find(x => x.model === model) || DB.products[state.prodIndex];
  if (!p) { toast('未找到产品', 'error'); return 0; }
  /* 导出列固定为「产品用例库全部字段」，不跟随列表的「筛选列」设置（同模块用例库） */
  const cols = COL_SCHEMAS.prod.fields.filter(f => f.key !== 'ops');
  const all = prodCaseRows(p);
  const idSet = ids && ids.length ? new Set(ids) : null;
  const list = idSet ? all.filter(r => idSet.has(r.id)) : all;
  await downloadXlsx(`产品用例库_${p.model}_${ymd()}.xlsx`, [
    { name: '产品用例', rows: xlsxRowsFrom(cols, list) },
    {
      name: '导出说明', rows: [
        ['产品型号', p.model], ['导出时间', nowStr()], ['用例总数', String(list.length)],
        ['引用模块库', String(list.filter(r => r.source === '引用模块库').length)],
        ['产品专属增补', String(list.filter(r => r.source === '产品专属增补').length)],
        ['导出字段', `全字段导出（${cols.length} 个字段，不含「操作」）`],
        ['字段清单', cols.map(f => f.label).join(' / ')]
      ]
    }
  ]);
  log('导出产品用例（Excel）', `${p.model}｜${list.length} 条｜${cols.length} 列`);
  return list.length;
};
/* 产品用例库：导出申请（与模块用例库一致，导出需审批） */
window.exportProd = function () {
  if (!guard('export')) return;
  const p = DB.products[state.prodIndex];
  if (!p) return;
  const list = prodCaseRows(p);
  const approvers = Array.from(new Set((DB.roles || []).filter(r => r.name === '一级' || r.name === '最高管理员').flatMap(r => r.users || []).concat(DB.deptMembers)));
  modal('导出申请（导出需审批）', `
    
    <table class="detail-table">
      <tr><td style="width:110px">导出范围：</td><td><b>${p.model}</b> 全部产品用例 <b>${list.length}</b> 条（引用模块库 ${list.filter(r => r.source === '引用模块库').length} 条、专属增补 ${list.filter(r => r.source === '产品专属增补').length} 条）</td></tr>
      <tr><td>导出原因：</td><td><input id="pexReason" style="width:100%" value="产品用例评审交付，需导出该产品用例库。"></td></tr>
      <tr><td>审批人：</td><td><div class="multi" id="pexBox">${approvers.map(a => `<label><input type="checkbox" class="pexchk" value="${a}" ${a === DB.currentUser ? 'checked' : ''}> ${a}</label>`).join('')}</div></td></tr>
      <tr><td>审批截止时间：</td><td><input id="pexDeadline" type="datetime-local" value="${today()}T18:00"></td></tr>
    </table>
    <div class="form-actions">
      <span class="hint" style="margin:0" id="pexTip"></span>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="pexOk">提交申请</button>
    </div>`);
  const sync = () => { $('#pexTip').textContent = `已选审批人 ${$$('.pexchk:checked').length} 人`; };
  $$('.pexchk').forEach(c => c.onchange = sync);
  sync();
  $('#pexOk').onclick = () => {
    const picked = $$('.pexchk:checked').map(c => c.value);
    if (!picked.length) { toast('请至少选择一位审批人'); return; }
    const deadline = ($('#pexDeadline').value || '').slice(0, 16) || `${today()} 18:00`;
    DB.exportRequests = DB.exportRequests || [];
    DB.exportRequests.unshift({
      id: `EX-2026-${String(DB.exportRequests.length + 21).padStart(4, '0')}`,
      type: '产品用例库导出', product: p.model, scope: `${p.model} 全部用例 ${list.length} 条`, count: list.length,
      /* 锁定申请时的产品用例集合：审批通过后由申请人导出，按此集合导出，条数与审批时一致 */
      caseIds: list.map(r => r.id),
      applicant: DB.currentUser, approvers: picked, reason: $('#pexReason').value.trim() || '—',
      deadline, submitDate: today(), submitAt: nowStr(), status: '审批中', opinion: '', filterDesc: `产品型号=${p.model}`
    });
    DB.notices = DB.notices || [];
    DB.notices.unshift({ time: nowStr(), to: picked.join('、'), type: '导出审批截止提醒', content: `导出申请审批截止时间 ${deadline}，剩余 ${daysToDeadline(deadline.slice(0, 10))} 天，将在 48/24/12 小时节点推送企业微信消息` });
    log('导出申请', `产品用例库 ${p.model} ${list.length} 条｜审批人 ${picked.join('、')}｜截止 ${deadline}`);
    closeTopModal(); renderApp();
    toast('导出申请已提交，待审批人审批', 'success');
  };
};
/* 产品用例库：导入 Excel（统一导入为产品专属增补用例） */
window.importProdExcel = function () {
  if (!guard('edit', '导入用例')) return;
  const p = DB.products[state.prodIndex];
  if (!p) return;
  modal(`导入产品用例（Excel）· ${p.model}`, `
    
    <div class="field"><label>选择 Excel 文件（.xlsx）</label><input type="file" id="prodImpFile" accept=".xlsx"></div>
    <div class="hint" style="margin:6px 0 0"><span class="link" onclick="downloadProdTemplate()">下载导入模板</span></div>
    <div id="prodImpTip" class="hint" style="margin:6px 0 0"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="prodImpOk">导入</button>
    </div>`);
  $('#prodImpFile').onchange = e => {
    const f = e.target.files[0];
    $('#prodImpTip').textContent = f ? `已选择：${f.name}` : '';
  };
  $('#prodImpOk').onclick = async () => {
    const f = $('#prodImpFile').files[0];
    if (!f) { toast('请先选择 Excel 文件'); return; }
    try {
      const sheets = await XLSX_LITE.read(await f.arrayBuffer());
      const rows = (sheets[0] && sheets[0].rows) || [];
      const res = importProdRowsFromExcel(rows, p.model);
      closeTopModal();
      renderProd();
      if (!res.added) { toast(res.errors[0] || '未导入任何用例', 'error'); return; }
      modal('导入结果', `
        <div class="hint">共解析 <b>${res.total}</b> 行，成功导入 <b>${res.added}</b> 条，跳过 ${res.skipped} 条。</div>
        <div class="hint">新编号：${res.ids.slice(0, 12).join('、')}${res.ids.length > 12 ? ' …' : ''}</div>
        ${res.errors.length ? `<div class="hint" style="color:#c0392b">跳过原因：<br>${res.errors.slice(0, 12).join('<br>')}${res.errors.length > 12 ? '<br>…' : ''}</div>` : ''}
        <div class="form-actions"><button class="btn btn-primary" onclick="closeTopModal()">知道了</button></div>`);
      toast(`已导入 ${res.added} 条产品专属增补用例`, 'success');
    } catch (err) {
      toast('解析失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    }
  };
};
window.exportStatsSummary = function () {
  if (!guard('export')) return;
  const std = DB.stdCases || [];
  const execs = DB.execTasks || [];
  const sum = execs.reduce((a, e) => {
    const s = execStats(e);
    a.planned += execPlanned(e); a.actual += s.actual; a.passed += s.passed; a.failed += s.failed; a.blocked += s.blocked; a.notRun += s.notRun; a.diverged += (e.diverged || 0);
    return a;
  }, { planned: 0, actual: 0, passed: 0, failed: 0, blocked: 0, notRun: 0, diverged: 0 });
  const bugs = DB.bugs || [];
  const rows = [['统计项', '数值', '说明']];
  rows.push(['统计时间', nowStr(), `统计人 ${DB.currentUser}`]);
  rows.push(['模块用例总数', std.length, `正常 ${std.filter(c => c.status === '正常').length} / 新增 ${std.filter(c => c.status === '新增').length} / 回退 ${std.filter(c => c.status === '回退').length} / 停用 ${std.filter(c => c.status === '停用').length}`]);
  rows.push(['自动化用例数', std.filter(c => c.autoFlag === '是').length, `覆盖率 ${pctStr(std.filter(c => c.autoFlag === '是').length, std.length)}`]);
  rows.push(['产品用例总数', DB.products.reduce((n, p) => n + prodCaseRows(p).length, 0), `${DB.products.length} 个产品`]);
  rows.push(['测试任务数', (DB.tasks || []).length, `进行中 ${(DB.tasks || []).filter(t => t.finished !== '是').length} / 已归档 ${(DB.tasks || []).filter(t => t.finished === '是').length}`]);
  rows.push(['执行任务数', execs.length, '']);
  rows.push(['计划执行用例', sum.planned, `实际执行 ${sum.actual}（${pctStr(sum.actual, sum.planned)}）`]);
  rows.push(['通过用例', sum.passed, `通过率 ${pctStr(sum.passed, sum.planned)}`]);
  rows.push(['失败用例', sum.failed, `阻塞 ${sum.blocked}／未执行 ${sum.notRun}`]);
  rows.push(['发散（临时）用例', sum.diverged, '']);
  rows.push(['缺陷总数', bugs.length, `已解决 ${bugs.filter(b => /已解决|已关闭/.test(b.status || '')).length}`]);
  rows.push(['市场问题', (DB.marketBugs || []).length, '']);
  downloadXlsx(`数据统计汇总_${ymd()}.xlsx`, [{ name: '统计汇总', rows }]);
  log('导出统计汇总', `${rows.length - 1} 项统计指标｜模块用例 ${std.length}｜执行任务 ${execs.length}｜缺陷 ${bugs.length}`);
  toast('统计汇总已导出', 'success');
};

/* ---- 设置（权限分级 / 权限移交） ================= */
/* ---- 设置（角色管理 + 权限变更记录） ---- */
function allPeople() {
  return Array.from(new Set([].concat(DB.deptMembers || [], (DB.roles || []).flatMap(r => r.users || []), [DB.currentUser]))).filter(Boolean).sort();
}
function renderPerm() {
  /* 设置页只对最高管理员开放：其他角色即使勾选了页面访问也不会显示入口 */
  if (roleRank() !== 0) {
    $('#page').innerHTML = '<div class="panel"><div class="empty" style="padding:40px 0">当前账号无访问权限</div></div>';
    return;
  }
  const roles = DB.roles || [];
  const canCfg = can('roleManage');
  const cfgTitle = canCfg ? '' : `title="当前账号（${DB.currentUser} · ${DB.currentRole}）无「角色与权限配置」权限"`;
  $('#page').innerHTML = `
    <div class="toolbar">
      <span class="chip chip-primary">当前账号 ${DB.currentUser} · ${DB.currentRole}</span>
      <div class="actions" style="margin-left:auto">
        ${can('manage') ? '<button class="btn btn-ghost" onclick="handoverPerm()">发起权限移交</button>' : ''}
        <button class="btn btn-primary" onclick="newRole()" ${canCfg ? '' : 'disabled'} ${cfgTitle}>＋ 新建角色</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">角色管理 <span class="chip">${roles.length} 个角色</span></h2>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th style="width:180px">角色</th><th>说明</th><th style="width:240px">成员</th><th style="width:90px">权限数</th><th style="width:110px">类型</th><th style="width:170px">操作</th></tr></thead>
        <tbody>${roles.map(r => `<tr>
          <td><b>${r.name}</b>${r.name === DB.currentRole ? ' <span class="chip chip-primary">当前</span>' : ''}</td>
          <td style="white-space:normal">${r.desc || '—'}</td>
          <td style="white-space:normal">${(r.users || []).join('、') || '—'}</td>
          <td>${(r.perms || []).length} 项</td>
          <td>${r.builtin ? '<span class="chip">系统内置</span>' : '<span class="chip chip-info">自定义</span>'}</td>
          <td>${canCfg
      ? `<span class="link" onclick="editRolePerms('${r.id}')">编辑</span>
                 <span class="link" onclick="copyRole('${r.id}')">复制</span>
                 ${r.builtin ? '<span class="link" style="color:#9aa7b4;cursor:default" title="系统内置角色不可删除">删除</span>' : `<span class="link" onclick="delRole('${r.id}')">删除</span>`}`
      : '<span class="hint" style="margin:0">无配置权限</span>'}</td>
        </tr>`).join('')}</tbody></table></div>
    </div>
    ${canCfg ? `<div class="panel" id="acctPanel">
      <div class="panel-header">
        <h2 class="panel-title">账号管理 <span class="chip" id="acctCount">加载中</span></h2>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onclick="refreshAccountPanel()">刷新</button>
          <button class="btn btn-primary btn-sm" onclick="accountCreateModal()">＋ 新建账号</button>
        </div>
      </div>
      <div class="table-wrap" style="max-height:40vh"><table>
        <thead><tr><th style="width:130px">账号</th><th>邮箱</th><th style="width:130px">角色</th><th style="width:76px">状态</th><th style="width:126px">注册时间</th><th style="width:126px">最近登录</th><th style="width:92px">来源</th><th style="width:200px">操作</th></tr></thead>
        <tbody id="acctBody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
      </table></div>
    </div>` : ''}
    ${roleRank() === 0 ? `<div class="panel" id="mailPanel">
      <div class="panel-header">
        <h2 class="panel-title">邮箱服务 <span class="chip" id="mailState">加载中</span></h2>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onclick="loadMailConfig()">刷新</button>
          <button class="btn btn-ghost btn-sm" onclick="testMailModal()">发送测试邮件</button>
          <button class="btn btn-primary btn-sm" onclick="saveMailConfig()">保存配置</button>
        </div>
      </div>
      <div class="form grid-2 mail-form">
        <div class="field field-inline"><label>SMTP 主机</label><input id="mcHost" placeholder="smtp.example.com"></div>
        <div class="field field-inline"><label>端口</label><input id="mcPort" placeholder="465"></div>
        <div class="field field-inline"><label>加密方式</label><select id="mcSecure"><option value="ssl">SSL（通常 465）</option><option value="starttls">STARTTLS（通常 587）</option></select></div>
        <div class="field field-inline"><label>发信账号</label><input id="mcUser" placeholder="notify@example.com"></div>
        <div class="field field-inline"><label>授权码</label><input id="mcPass" type="password" placeholder="请输入授权码 / 密码"></div>
        <div class="field field-inline"><label>发件地址</label><input id="mcFrom" placeholder="默认同发信账号"></div>
        <div class="field field-inline"><label>发信人名称</label><input id="mcFromName" placeholder="测试任务执行平台"></div>
        <div class="field field-inline"><label>调试模式</label><div class="switch-line"><input type="checkbox" id="mcDev"> <span>不发信，验证码直接返回</span></div></div>
      </div>
    </div>` : ''}
    <div class="panel">
      <div class="panel-header">
        <h2 class="panel-title">权限变更记录 <span class="chip">${(DB.permAudits || []).length} 条</span></h2>
      </div>
      <div class="table-wrap" style="max-height:42vh"><table>
        <thead><tr><th style="width:150px">时间</th><th style="width:110px">操作人</th><th style="width:220px">变更对象</th><th>变更内容</th></tr></thead>
        <tbody>${(DB.permAudits || []).map(a => `<tr>
          <td>${a.time}</td><td>${a.operator}</td><td>${a.target}</td><td style="white-space:normal">${a.action}</td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty">暂无变更记录</td></tr>'}      </tbody></table></div>
    </div>`;
  /* 账号列表由后端 accounts.json 维护，走接口异步拉取；邮箱配置仅最高管理员可见 */
  if (canCfg) loadPermAccounts();
  if (roleRank() === 0) loadMailConfig();
}
/* ---------- 账号管理（新建 / 改角色 / 重置口令 / 停用 / 删除） ---------- */
const ACCT_ADMIN_ROLES = ['最高管理员', '一级'];   // 与 server/auth.js 的 ADMIN_ROLES 保持一致
let ACCT = null;        // 账号列表缓存
let ACCT_ERR = '';      // 加载失败原因
function acctRoleNames() { return (DB.roles || []).map(r => r.name); }
window.refreshAccountPanel = function () {
  ACCT = null;
  ACCT_ERR = '';
  paintAccountRows();
  loadPermAccounts();
};
async function loadPermAccounts() {
  if (typeof API === 'undefined' || !API.accounts) return;
  try { const r = await API.accounts(); ACCT = r.accounts || []; ACCT_ERR = ''; }
  catch (e) { ACCT = null; ACCT_ERR = e.message || '加载失败'; }
  paintAccountRows();
}
function paintAccountRows() {
  const tb = document.getElementById('acctBody');
  if (!tb) return;
  const cnt = document.getElementById('acctCount');
  if (cnt) cnt.textContent = ACCT ? `${ACCT.length} 个账号` : (ACCT_ERR ? '加载失败' : '加载中');
  if (ACCT_ERR) { tb.innerHTML = `<tr><td colspan="8" class="empty">账号列表加载失败：${ACCT_ERR}</td></tr>`; return; }
  if (!ACCT) { tb.innerHTML = '<tr><td colspan="8" class="empty">加载中…</td></tr>'; return; }
  tb.innerHTML = ACCT.map(a => {
    const adm = ACCT_ADMIN_ROLES.includes(a.role);
    const self = a.name === DB.currentUser;
    return `<tr>
      <td><b>${a.name}</b>${self ? ' <span class="chip chip-primary">当前</span>' : ''}</td>
      <td style="white-space:normal">${a.email || '—'}</td>
      <td>${a.role}${adm ? ' <span class="chip chip-info">管理员</span>' : ''}</td>
      <td>${a.status === 'disabled' ? '<span class="chip chip-danger">已停用</span>' : '<span class="chip chip-success">正常</span>'}</td>
      <td>${a.createdAt || '—'}</td>
      <td>${a.lastLoginAt || '从未登录'}</td>
      <td>${a.createdBy || '—'}</td>
      <td><span class="link" onclick="accountRoleModal('${a.name}')">改角色</span>
        <span class="link" title="重置为初始口令 123456" onclick="accountResetPwd('${a.name}')">重置</span>
        ${self ? '<span class="hint" style="margin:0">—</span>' : `
          <span class="link" onclick="accountToggle('${a.name}','${a.status === 'disabled' ? 'active' : 'disabled'}')">${a.status === 'disabled' ? '启用' : '停用'}</span>
          <span class="link" onclick="accountDelete('${a.name}')">删除</span>`}</td>
    </tr>`;
  }).join('');
  /* 表体是异步填充的：填充完重算一次列宽，避免沿用「加载中」时的列宽 */
  const tbl = tb.closest('table');
  if (tbl && typeof fitTable === 'function') fitTable(tbl);
}
/* ---------- 邮箱服务配置（仅最高管理员） ---------- */
async function loadMailConfig() {
  const st = document.getElementById('mailState');
  if (!st || typeof API === 'undefined' || !API.mailConfig) return;
  try {
    const r = await API.mailConfig();
    const c = r.config || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('mcHost', c.host || '');
    set('mcPort', c.port || 465);
    set('mcUser', c.user || '');
    set('mcFrom', c.from || '');
    set('mcFromName', c.fromName || '');
    const sec = document.getElementById('mcSecure');
    if (sec) sec.value = c.secure ? 'ssl' : 'starttls';
    const dev = document.getElementById('mcDev');
    if (dev) dev.checked = !!c.dev;
    const pass = document.getElementById('mcPass');
    if (pass) { pass.value = ''; pass.placeholder = c.hasPass ? '已设置（留空表示不修改）' : '请输入授权码 / 密码'; }
    st.textContent = c.ready ? (c.dev ? '调试模式' : '已就绪') : '未配置';
    st.className = 'chip ' + (c.ready ? (c.dev ? 'chip-info' : 'chip-success') : '');
  } catch (e) {
    st.textContent = '加载失败';
    st.className = 'chip';
  }
}
window.saveMailConfig = async function () {
  if (roleRank() !== 0) return;
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const body = {
    host: v('mcHost'),
    port: Number(v('mcPort') || 465),
    secure: v('mcSecure') === 'ssl',
    starttls: v('mcSecure') === 'starttls',
    user: v('mcUser'),
    pass: v('mcPass'),
    from: v('mcFrom'),
    fromName: v('mcFromName'),
    dev: !!(document.getElementById('mcDev') || {}).checked
  };
  if (!body.dev && (!body.host || !body.user)) { toast('请填写 SMTP 主机与发信账号（或开启调试模式）', 'error'); return; }
  try {
    await API.saveMailConfig(body);
    await loadMailConfig();
    toast('邮箱服务配置已保存', 'success');
  } catch (e) { toast(e.message || '保存失败', 'error'); }
};
window.testMailModal = function () {
  if (roleRank() !== 0) return;
  modal('发送测试邮件', `
    <div class="form">
      <div class="field"><label>收件邮箱</label><input id="tmTo" placeholder="name@company.com" value="${(SESSION && SESSION.email) || ''}"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="tmOk">发送</button>
    </div>`);
  $('#tmOk').onclick = async () => {
    const to = $('#tmTo').value.trim();
    if (!to) { toast('请填写收件邮箱', 'error'); return; }
    const btn = $('#tmOk');
    btn.disabled = true; btn.textContent = '发送中…';
    try {
      const r = await API.testMail(to);
      closeTopModal();
      toast((r && r.message) || '测试邮件已发送', 'success');
    } catch (e) {
      toast(e.message || '发送失败', 'error');
      btn.disabled = false; btn.textContent = '发送';
    }
  };
};
/* 角色调整落库后同步「角色成员表」：一人一角色，save() 时后端的 syncRoles 会再次核对，避免被旧成员表覆盖 */
function applyAccountRoleLocally(name, role) {
  (DB.roles || []).forEach(r => { r.users = (r.users || []).filter(u => u !== name); });
  const t = (DB.roles || []).find(r => r.name === role);
  if (t) t.users = (t.users || []).concat([name]);
  if (!(DB.deptMembers || []).includes(name)) DB.deptMembers = (DB.deptMembers || []).concat([name]);
  if (name === DB.currentUser) DB.currentRole = role;
  save();
  renderPerm();
}
window.accountRoleModal = function (name) {
  if (!guard('roleManage', '账号管理')) return;
  const a = (ACCT || []).find(x => x.name === name);
  if (!a) { toast('账号信息未加载，请先刷新列表', 'error'); return; }
  modal(`调整角色 · ${name}`, `
    
    <div class="form" style="grid-template-columns:1fr">
      <div class="field"><label>新角色</label><select id="acRole">${acctRoleNames().map(n => `<option ${n === a.role ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="acRoleOk">保存</button>
    </div>`);
  $('#acRoleOk').onclick = async () => {
    const role = $('#acRole').value;
    if (role === a.role) { closeTopModal(); return; }
    try {
      await API.setAccountRole(name, role);
      /* 先更新列表缓存，再同步角色成员表（applyAccountRoleLocally 内部重绘权限页） */
      if (ACCT) { const it = ACCT.find(x => x.name === name); if (it) it.role = role; }
      applyAccountRoleLocally(name, role);
      log('调整账号角色', `${name}：${a.role} → ${role}`, '', { module: '权限' });
      closeTopModal();
      toast(`已将「${name}」的角色调整为「${role}」`, 'success');
    } catch (e) { toast(e.message || '保存失败', 'error'); }
  };
};
window.accountResetPwd = function (name) {
  if (!guard('roleManage', '账号管理')) return;
  modal(`重置口令 · ${name}`, `
    
    <div class="form" style="grid-template-columns:1fr">
      <div class="field"><label>新口令（至少 6 位）</label><input id="acPwd" value="123456"></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="acPwdOk">重置口令</button>
    </div>`);
  $('#acPwdOk').onclick = async () => {
    const pwd = ($('#acPwd').value || '').trim();
    if (pwd.length < 6) { toast('新口令至少 6 位'); return; }
    try {
      await API.resetAccountPassword(name, pwd);
      log('重置账号口令', name, '', { module: '权限' });
      closeTopModal();
      toast(`已重置「${name}」的登录口令`, 'success');
      refreshAccountPanel();
    } catch (e) { toast(e.message || '重置失败', 'error'); }
  };
};
window.accountToggle = function (name, status) {
  if (!guard('roleManage', '账号管理')) return;
  const off = status === 'disabled';
  confirmModal(off ? '停用账号' : '启用账号',
    `<p>确定${off ? '停用' : '启用'}账号 <b>${name}</b>？</p>${off ? '<p style="color:#c0392b">停用后该账号无法登录，已登录的会话立即失效。</p>' : ''}`,
    async () => {
      try {
        await API.setAccountStatus(name, status);
        log(off ? '停用账号' : '启用账号', name, '', { module: '权限' });
        closeTopModal();
        toast(`账号「${name}」已${off ? '停用' : '启用'}`, 'success');
        refreshAccountPanel();
      } catch (e) { toast(e.message || '操作失败', 'error'); }
    },
    off ? '停用' : '启用');
};
window.accountDelete = function (name) {
  if (!guard('roleManage', '账号管理')) return;
  confirmModal('删除账号',
    `<p>确定删除账号 <b>${name}</b>？</p><p>删除后该账号无法再登录，其在角色中的成员身份一并移除；已产生的业务数据（用例、任务、日志）保留。</p>`,
    async () => {
      try {
        await API.deleteAccount(name);
        if (ACCT) ACCT = ACCT.filter(x => x.name !== name);
        (DB.roles || []).forEach(r => { r.users = (r.users || []).filter(u => u !== name); });
        DB.deptMembers = (DB.deptMembers || []).filter(u => u !== name);
        save();
        log('删除账号', name, '', { module: '权限' });
        closeTopModal();
        toast(`账号「${name}」已删除`, 'success');
        renderPerm();
      } catch (e) { toast(e.message || '删除失败', 'error'); }
    }, '删除');
};
window.accountCreateModal = function () {
  if (!guard('roleManage', '账号管理')) return;
  modal('新建账号', `
    
    <div class="form" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>账号（姓名 / 工号，必填）</label><input id="acNewName" placeholder="2-20 位，中文 / 字母 / 数字"></div>
      <div class="field"><label>初始口令（至少 6 位）</label><input id="acNewPwd" value="123456"></div>
    </div>
    <div class="form" style="grid-template-columns:1fr">
      <div class="field"><label>角色</label><select id="acNewRole">${acctRoleNames().map(n => `<option ${n === '三级' ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="acNewOk">创建</button>
    </div>`);
  $('#acNewOk').onclick = async () => {
    const name = ($('#acNewName').value || '').trim();
    const pwd = ($('#acNewPwd').value || '').trim();
    const role = $('#acNewRole').value;
    if (!name) { toast('请填写账号'); return; }
    if (pwd.length < 6) { toast('初始口令至少 6 位'); return; }
    try {
      await API.createAccount(name, pwd, role);
      /* 同步角色成员表并重绘（账号列表由 renderPerm 内的接口拉取刷新） */
      applyAccountRoleLocally(name, role);
      closeTopModal();
      log('新建账号', `${name}（角色 ${role}）`, '', { module: '权限' });
      toast(`账号「${name}」已创建（角色 ${role}）`, 'success');
    } catch (e) { toast(e.message || '创建失败', 'error'); }
  };
};
/* 角色编辑（新建 / 编辑共用）：名称、说明、权限项分组勾选、成员多选 */
function roleEditModal(r, isNew) {
  const picked0 = r.users || [];
  const people = allPeople();
  modal(`${isNew ? '新建角色' : '编辑角色'} · ${r.name || '（未命名）'}`, `
    
    <div class="form" style="grid-template-columns:1fr 1.6fr">
      <div class="field"><label>角色名称（必填）</label><input id="erName" value="${r.name || ''}"></div>
      <div class="field"><label>角色说明</label><input id="erDesc" value="${r.desc || ''}" placeholder="如：测试部全员"></div>
    </div>
    <div class="panel-header" style="margin:10px 0 6px">
      <h4 class="sub-title" style="margin:0">权限项（${permItems().length} 项，已选 <b id="erCount">0</b>）</h4>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" id="erAllOn">全选</button>
        <button class="btn btn-ghost btn-sm" id="erAllOff">清空</button>
      </div>
    </div>
    ${permCatalog().map(g => `
      <div class="perm-edit-group">
        <div class="peg-head">
          <b>${g.group}</b>
          <span class="hint" style="margin:0">
            <span class="link" data-gall="on" data-g="${g.group}">全选</span>
            <span class="link" data-gall="off" data-g="${g.group}">清空</span>
          </span>
        </div>
        <div class="col-picker-list" style="grid-template-columns:repeat(3,1fr)">
          ${(g.items || []).map(i => `<label title="${i.desc || i.label}"><input type="checkbox" class="erchk" data-g="${g.group}" value="${i.k}" ${(r.perms || []).includes(i.k) ? 'checked' : ''}> ${i.label}</label>`).join('')}
        </div>
      </div>`).join('')}
    <div class="panel-header" style="margin:12px 0 6px">
      <h4 class="sub-title" style="margin:0">成员（已选 <b id="erUserCount">${picked0.length}</b> 人）</h4>
      
    </div>
    <div class="field"><input id="erUserKw" placeholder="搜索人员姓名"></div>
    <div class="multi" id="erUsers">${people.map(u => `<label class="eruser" data-name="${u}">
      <input type="checkbox" class="eruchk" value="${u}" ${picked0.includes(u) ? 'checked' : ''}> ${u}
      <em class="eruser-role">${roleOf(u)}</em></label>`).join('')}</div>
    <div class="field" style="margin-top:8px"><label>添加新成员（多人用逗号 / 空格分隔，自动加入角色）</label><input id="erNewUsers" placeholder="如：张三、李四"></div>
    <div class="hint" id="erTip" style="margin-top:8px"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="erOk">保存</button>
    </div>`);
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1180px, 95vw)';
  const sync = () => {
    const perms = $$('.erchk:checked').map(c => c.value);
    $('#erCount').textContent = perms.length;
    $('#erUserCount').textContent = $$('.eruchk:checked').length;
    const noPage = !perms.some(p => String(p).indexOf('page.') === 0);
    $('#erTip').innerHTML = `${perms.length ? `已选权限：${permLabels(perms)}` : '未勾选任何权限（该角色将无法使用平台功能）'}${noPage ? '　<span class="chip chip-warn">未勾选「页面访问」权限：该角色登录后仅能看到「我的待办」</span>' : ''}`;
  };
  $$('.erchk').forEach(c => c.onchange = sync);
  $$('.eruchk').forEach(c => c.onchange = sync);
  $$('[data-gall]').forEach(el => el.onclick = () => {
    const g = el.dataset.g, on = el.dataset.gall === 'on';
    $$('.erchk').forEach(c => { if (c.dataset.g === g) c.checked = on; });
    sync();
  });
  $('#erAllOn').onclick = () => { $$('.erchk').forEach(c => c.checked = true); sync(); };
  $('#erAllOff').onclick = () => { $$('.erchk').forEach(c => c.checked = false); sync(); };
  $('#erUserKw').oninput = () => {
    const kw = $('#erUserKw').value.trim();
    $$('.eruser').forEach(el => { el.style.display = (!kw || el.dataset.name.indexOf(kw) >= 0) ? '' : 'none'; });
  };
  sync();
  $('#erOk').onclick = () => {
    const name = $('#erName').value.trim();
    if (!name) { toast('请填写角色名称'); return; }
    if ((DB.roles || []).some(x => x.name === name && x !== r)) { toast(`角色名称「${name}」已存在`); return; }
    const perms = $$('.erchk:checked').map(c => c.value);
    if (!perms.length) { toast('请至少勾选一项权限'); return; }
    const users = Array.from(new Set($$('.eruchk:checked').map(c => c.value)
      .concat($('#erNewUsers').value.split(/[,，、\s]+/).filter(Boolean))));
    const before = { name: r.name, desc: r.desc || '', perms: (r.perms || []).slice(), users: (r.users || []).slice() };
    /* 一人一角色：成员从其他角色移除 */
    const moved = [];
    users.forEach(u => {
      (DB.roles || []).forEach(o => {
        if (o === r || !(o.users || []).includes(u)) return;
        o.users = o.users.filter(x => x !== u);
        moved.push(`${u}（原「${o.name}」）`);
      });
      if (!DB.deptMembers.includes(u)) DB.deptMembers.push(u);
    });
    r.name = name; r.desc = $('#erDesc').value.trim(); r.perms = perms; r.users = users;
    if (isNew) (DB.roles = DB.roles || []).push(r);
    /* 编辑的是当前演示角色且改名时，跟随新名称 */
    if (!isNew && before.name !== name && DB.currentRole === before.name) DB.currentRole = name;
    /* 权限项级留痕：明确记录「哪几项权限被勾选 / 取消」「哪几个人被加入 / 移出」，而不只是数量 */
    const addedPerms = perms.filter(p => !before.perms.includes(p));
    const removedPerms = before.perms.filter(p => !perms.includes(p));
    const addedUsers = users.filter(u => !before.users.includes(u));
    const removedUsers = before.users.filter(u => !users.includes(u));
    const changes = [];
    if (!isNew && before.name !== name) changes.push({ field: '角色名称', from: before.name, to: name });
    if (!isNew && before.desc !== r.desc) changes.push({ field: '角色说明', from: before.desc || '（空）', to: r.desc || '（空）' });
    if (addedPerms.length) changes.push({ field: '新增权限', from: '（未勾选）', to: permLabels(addedPerms) });
    if (removedPerms.length) changes.push({ field: '取消权限', from: permLabels(removedPerms), to: '（已取消）' });
    if (addedUsers.length) changes.push({ field: '新增成员', from: '（不在角色内）', to: addedUsers.join('、') });
    if (removedUsers.length) changes.push({ field: '移出成员', from: removedUsers.join('、'), to: '（已移出）' });
    const permText = [addedPerms.length ? `+${permLabels(addedPerms)}` : '', removedPerms.length ? `-${permLabels(removedPerms)}` : '']
      .filter(Boolean).join('；');
    auditPerm(`角色 · ${name}`, isNew
      ? `新建角色（${perms.length} 项权限${users.length ? `，${users.length} 名成员` : ''}）：${permLabels(perms)}`
      : `权限 ${before.perms.length} → ${perms.length} 项${permText ? `（${permText}）` : ''}；成员 ${before.users.length} → ${users.length} 人`
      + `${addedUsers.length ? `；新增成员 ${addedUsers.join('、')}` : ''}${removedUsers.length ? `；移出成员 ${removedUsers.join('、')}` : ''}`
      + `${before.name !== name ? `；名称「${before.name}」→「${name}」` : ''}`);
    log(isNew ? '新建角色' : '修改角色权限',
      isNew ? `${name}｜权限 ${perms.length} 项：${permLabels(perms)}｜成员 ${users.join('、') || '无'}`
        : `${name}｜${changesText(changes) || '权限与成员均未变化'}${moved.length ? `｜成员原角色变动：${moved.join('；')}` : ''}`,
      '', { module: '权限', objType: '角色', objId: name, changes });
    save(); closeTopModal(); renderApp();
    toast(`「${name}」已保存（${perms.length} 项权限，${users.length} 名成员）${moved.length ? `，${moved.length} 名成员已从原角色移除` : ''}`, 'success');
  };
}
window.editRolePerms = function (roleId) {
  if (!guard('roleManage', '角色与权限配置')) return;
  const r = (DB.roles || []).find(x => x.id === roleId) || (DB.roles || []).find(x => x.name === roleId);
  if (!r) { toast('角色不存在'); return; }
  roleEditModal(r, false);
};
window.newRole = function () {
  if (!guard('roleManage', '角色与权限配置')) return;
  roleEditModal({ id: `R-${Date.now().toString().slice(-6)}`, name: '', desc: '', builtin: false, users: [], perms: ['page.perm'] }, true);
};
window.copyRole = function (roleId) {
  if (!guard('roleManage', '角色与权限配置')) return;
  const r = (DB.roles || []).find(x => x.id === roleId);
  if (!r) return;
  const copy = { id: `R-${Date.now().toString().slice(-6)}`, name: `${r.name}-副本`, desc: `${r.desc || '（无说明）'}（复制自「${r.name}」）`, builtin: false, users: [], perms: (r.perms || []).slice() };
  DB.roles = DB.roles || [];
  DB.roles.push(copy);
  auditPerm(`角色 · ${copy.name}`, `复制自「${r.name}」（${copy.perms.length} 项权限，成员未复制）`);
  log('复制角色', `${r.name} → ${copy.name}`);
  save(); renderApp();
  toast(`已复制为「${copy.name}」，可继续编辑权限与成员`, 'success');
};
window.delRole = function (roleId) {
  if (!guard('roleManage', '角色与权限配置')) return;
  const r = (DB.roles || []).find(x => x.id === roleId);
  if (!r) return;
  if (r.builtin) { toast('系统内置角色不可删除'); return; }
  const fb = (DB.roles || []).find(x => x.name === '二级') || (DB.roles || [])[0];
  confirmModal('删除角色', `<p>确定删除角色 <b>${r.name}</b>？其 ${(r.users || []).length} 名成员将回落到「${fb ? fb.name : '—'}」角色。</p>`, () => {
    (r.users || []).forEach(u => { if (fb && !(fb.users || []).includes(u)) fb.users = (fb.users || []).concat(u); });
    DB.roles = (DB.roles || []).filter(x => x !== r);
    if (DB.currentRole === r.name && fb) DB.currentRole = fb.name;
    auditPerm(`角色 · ${r.name}`, `删除角色，${(r.users || []).length} 名成员回落至「${fb ? fb.name : '—'}」`);
    log('删除角色', `${r.name}`);
    save(); closeTopModal(); renderApp();
    toast(`角色「${r.name}」已删除`, 'success');
  });
};

window.handoverPerm = function () {
  if (!guard('manage')) return;
  const modules = DB.stdModules.map(m => m.name);
  const tasks = DB.tasks.map(t => `${t.name}（${t.id}）`);
  modal('发起权限移交', `
    
    <table class="detail-table">
      <tr><td style="width:110px">移交类型：</td><td><select id="hoType">
        <option value="模块维护责任人">模块维护责任人</option>
        <option value="任务权限">任务权限</option>
        <option value="审核权限">审核权限</option>
      </select></td></tr>
      <tr><td>移交对象：</td><td><select id="hoObject"></select></td></tr>
      <tr><td>原责任人：</td><td><b>${DB.currentUser}</b></td></tr>
      <tr><td>接收人：</td><td><select id="hoTo">${DB.deptMembers.filter(x => x !== DB.currentUser).map(x => `<option>${x}</option>`).join('')}${(DB.roles || []).flatMap(r => r.users || []).filter(u => u !== DB.currentUser && !DB.deptMembers.includes(u)).map(u => `<option>${u}</option>`).join('')}</select></td></tr>
      <tr><td>移交原因：</td><td><input id="hoReason" style="width:100%" value="人员岗位调整，移交相关权限。"></td></tr>
      <tr><td>生效日期：</td><td><input id="hoDate" type="date" value="${today()}"></td></tr>
    </table>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="hoOk">确认移交</button>
    </div>`);
  const fillObjects = () => {
    const type = $('#hoType').value;
    const opts = type === '模块维护责任人' ? modules : (type === '任务权限' ? tasks : DB.stdModules.map(m => `${m.name} 用例审核`).concat(DB.products.map(p => `${p.model} 产品用例审核`)));
    $('#hoObject').innerHTML = opts.map(o => `<option>${o}</option>`).join('');
  };
  $('#hoType').onchange = fillObjects;
  fillObjects();
  $('#hoOk').onclick = () => {
    const type = $('#hoType').value, object = $('#hoObject').value, to = $('#hoTo').value;
    const reason = $('#hoReason').value.trim() || '—', date = $('#hoDate').value || today();
    const id = `YJ-${new Date().getFullYear()}-${String((DB.handovers || []).length + 3).padStart(4, '0')}`;
    DB.handovers = DB.handovers || [];
    DB.handovers.unshift({ id, type, object, from: DB.currentUser, to, reason, date, status: '已生效' });
    if (type === '模块维护责任人') {
      const name = object.replace(/（.*$/, '');
      const m = DB.stdModules.find(x => x.name === name);
      if (m) m.owner = to;
      if (!DB.deptMembers.includes(to)) DB.deptMembers.push(to);
    }
    if (type === '任务权限') {
      const tid = (object.match(/（([^）]+)）/) || [])[1];
      const t = DB.tasks.find(x => x.id === tid);
      if (t) t.testLead = to;
    }
    log('权限移交', `${id}｜${type}｜${object}｜${DB.currentUser} → ${to}｜${reason}`);
    closeTopModal(); renderApp();
    toast('权限已移交，接收人即时生效', 'success');
  };
};

/* ================= 归档任务（按年份索引完结任务 + 统计 + 执行记录） ================= */
function taskDateOf(t) {
  const m = String((t && t.id) || '').match(/^RW(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '—';
}
function taskYearOf(t) { const d = taskDateOf(t); return d === '—' ? '—' : d.slice(0, 4); }
function archivedTasks() { return DB.tasks.filter(t => t.finished === '是'); }
function renderArchive() {
  const all = archivedTasks();
  const years = Array.from(new Set(all.map(taskYearOf))).sort().reverse();
  const year = state.archiveYear && years.includes(state.archiveYear) ? state.archiveYear : (years[0] || '');
  state.archiveYear = year;
  const list = all.filter(t => taskYearOf(t) === year);
  if (!state.archiveTaskId || !list.some(t => t.id === state.archiveTaskId)) state.archiveTaskId = list[0] ? list[0].id : '';
  const cur = list.find(t => t.id === state.archiveTaskId) || null;
  const execs = cur ? DB.execTasks.filter(e => e.taskId === cur.id) : [];
  const stat = execs.reduce((a, e) => {
    const s = execStats(e);
    a.planned += execPlanned(e); a.actual += s.actual; a.passed += s.passed; a.failed += s.failed; a.blocked += s.blocked; a.notRun += s.notRun; a.diverged += (e.diverged || 0);
    return a;
  }, { planned: 0, actual: 0, passed: 0, failed: 0, blocked: 0, notRun: 0, diverged: 0 });
  const rate = stat.planned ? (stat.passed * 100 / stat.planned).toFixed(2) : '0.00';
  $('#page').innerHTML = `
    <div class="toolbar">
      <div><label>归档年份</label><select id="arYear">${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('') || '<option>—</option>'}</select></div>
      <span class="chip">完结任务 ${all.length} 个</span>
      <span class="chip chip-info">当前年份 ${year || '—'}：${list.length} 个任务</span>
    </div>
    <div class="flex">
      <aside class="sidebar">
        <h4>归档索引</h4>
        <div class="tree-list">
          ${years.map(y => `<div class="tree-item ${y === year ? 'active' : ''}" data-year="${y}">
            <div class="ti-name"><span class="expand">▾</span> ${y} 年 <span class="ti-edit">${all.filter(t => taskYearOf(t) === y).length}</span></div>
            <div class="ti-meta">${all.filter(t => taskYearOf(t) === y).reduce((n, t) => n + DB.execTasks.filter(e => e.taskId === t.id).length, 0)} 个执行任务</div>
          </div>`).join('') || '<div class="empty" style="padding:20px">暂无归档任务</div>'}
        </div>
      </aside>
      <div class="main">
        <div class="panel">
          <div class="panel-header"><h2 class="panel-title">${year || '—'} 年归档任务</h2></div>
          <div class="table-wrap"><table>
            <thead><tr><th>任务编号</th><th>任务名称</th><th>任务类型</th><th>测试主负责人</th><th>用例来源</th><th>完结日期</th><th>执行任务数</th><th>操作</th></tr></thead>
            <tbody>${list.map(t => `<tr>
              <td>${t.id}</td><td>${t.name}</td><td>${t.type}</td><td>${t.testLead || '—'}</td>
              <td style="white-space:normal">${t.caseSource || '—'}</td><td>${t.archivedAt || taskDateOf(t)}</td>
              <td>${DB.execTasks.filter(e => e.taskId === t.id).length}</td>
              <td><span class="link" onclick="state.archiveTaskId='${t.id}';renderArchive()">查看执行记录</span></td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty">该年份暂无归档任务</td></tr>'}</tbody></table></div>
        </div>
        ${cur ? `
        <div class="panel">
          <div class="panel-header">
            <h2 class="panel-title">${cur.name} · 统计信息</h2>
          </div>
          ${execs.length ? `<div class="table-wrap"><table>
            <thead><tr><th>执行任务编号</th><th>任务名称</th><th>产品型号</th><th>轮数</th><th>执行人</th><th>计划数</th><th>实际</th><th>通过</th><th>失败</th><th>阻塞</th><th>未执行</th><th>发散用例条数</th><th>操作</th></tr></thead>
            <tbody>${execs.map(e => {
      const s = execStats(e);
      return `<tr><td>${e.execId}</td><td>${e.name}</td><td>${e.model}</td><td>${e.round}</td><td>${e.executors}</td>
              <td>${execPlanned(e)}</td><td>${s.actual}</td><td>${s.passed}</td><td>${s.failed}</td><td>${s.blocked}</td><td>${s.notRun}</td><td>${e.diverged || 0}</td>
              <td><span class="link" onclick="openExecDetail('${e.execId}')">查看执行记录</span></td></tr>`;
    }).join('')}</tbody></table></div>
          <div class="hint">合计：计划 ${stat.planned} 条　实际执行 ${stat.actual} 条　通过 ${stat.passed}　失败 ${stat.failed}　阻塞 ${stat.blocked}　未执行 ${stat.notRun}　
            发散（临时）用例 ${stat.diverged} 条　通过率 ${rate}%</div>` : `
          <div class="hint">该归档任务未创建执行任务，以下为其在平台内的历史流程记录（只读）。</div>
          <div class="table-wrap"><table>
            <thead><tr><th>时间</th><th>执行任务</th><th>操作人</th><th>流程记录</th></tr></thead>
            <tbody>${(DB.taskLogs || []).filter(l => l.taskId === cur.id).map(l => `<tr>
              <td>${l.time}</td><td>${l.execId || '—'}</td><td>${l.operator}</td><td style="white-space:normal">${l.action}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">暂无流程记录</td></tr>'}</tbody></table></div>`}
        </div>` : ''}
      </div>
    </div>`;
  $$('.tree-item[data-year]').forEach(el => el.onclick = () => { state.archiveYear = el.dataset.year; state.archiveTaskId = ''; renderArchive(); });
  const y = $('#arYear');
  if (y) y.onchange = () => { state.archiveYear = y.value; state.archiveTaskId = ''; renderArchive(); };
}

/* ================= 用例编写页（草稿）+ 用例导入（外部导入 / 用例库导入） ================= */
const DRAFT_COLS = [
  { k: 'module', label: '功能模块', w: 120, ph: '必填' },
  { k: 'domain', label: '用例领域', w: 90 },
  { k: 'branch', label: '分支类型', w: 120 },
  { k: 'refProducts', label: '适用产品型号', w: 130, ph: '「指定产品」必填，多个用「、」分隔' },
  { k: 'level', label: '用例等级', w: 70 },
  { k: 'source', label: '用例来源', w: 90 },
  { k: 'testType', label: '测试类型', w: 90 },
  { k: 'functionPoint', label: '功能点', w: 110, ph: '必填' },
  { k: 'testPoint', label: '测试点', w: 100 },
  { k: 'summary', label: '用例概述', w: 190, ph: '必填' },
  { k: 'pre', label: '前置条件', w: 160, ph: '必填' },
  { k: 'steps', label: '详细概述 / 操作步骤', w: 200, ph: '必填' },
  { k: 'input', label: '输入数据', w: 100, ph: '必填' },
  { k: 'expect', label: '预期结果 / 测试标准', w: 170, ph: '必填' },
  { k: 'remark', label: '备注', w: 90 },
  { k: 'minutes', label: '手动测试时间(min)', w: 110 },
  { k: 'autoFlag', label: '自动化标志', w: 90 },
  { k: 'autoTool', label: '自动化工具', w: 120 },
  { k: 'autoTime', label: '自动化测试时间(min)', w: 130 }
];
const DRAFT_REQUIRED = ['module', 'functionPoint', 'summary', 'pre', 'steps', 'input', 'expect'];
function draftRowHtml(r, i) {
  return `<tr class="${r.__error ? 'row-error' : ''}" data-row="${i}">
    <td><input type="checkbox" class="dchk" data-idx="${i}"></td>
    <td>${i + 1}</td>
    ${DRAFT_COLS.map(c => `<td>${c.k === 'branch' || c.k === 'domain' || c.k === 'level' || c.k === 'source' || c.k === 'testType' || c.k === 'autoFlag'
      ? `<select class="df" data-idx="${i}" data-k="${c.k}" style="min-width:${c.w - 20}px">${(c.k === 'branch' ? ['产品通用', '指定产品'] : c.k === 'domain' ? DOMAIN_OPTIONS : c.k === 'level' ? ['L1', 'L2', 'L3'] : c.k === 'source' ? ['需求', '设计', '市场问题', 'BUG 反推', '测试发散', '测试任务', '其他'] : c.k === 'testType' ? ['功能测试', '易用性测试', '兼容性测试', '性能测试', '可靠性测试', '安全测试'] : ['否', '是']).map(o => `<option ${(r[c.k] || '') === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input class="df" data-idx="${i}" data-k="${c.k}" value="${r[c.k] == null ? '' : String(r[c.k]).replace(/"/g, '&quot;')}" placeholder="${c.ph || ''}" style="min-width:${c.w - 20}px">`}</td>`).join('')}
    <td><span class="link" onclick="removeDraftRow(${i})">删除</span></td></tr>`;
}
function draftPageHtml() {
  const rows = DB.draftCases || [];
  return `
    
    <div class="toolbar" style="box-shadow:none;margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" id="dkExternal">外部导入</button>
      <button class="btn btn-ghost btn-sm" id="dkFromStd">用例库导入</button>
      <button class="btn btn-ghost btn-sm" id="dkAdd">添加空行</button>
      <button class="btn btn-ghost btn-sm" id="dkDel">删除选中行</button>
      <button class="btn btn-ghost btn-sm" id="dkClear">清空</button>
      <span class="hint" style="margin:0">共 <b id="draftCount">${rows.length}</b> 条${rows.filter(r => r.__error).length ? `　<span class="chip chip-danger">${rows.filter(r => r.__error).length} 条待修正</span>` : ''}</span>
    </div>
    <div class="table-wrap" style="max-height:52vh">
      <table id="draftTable"><thead><tr><th style="width:36px"></th><th style="width:40px">#</th>
        ${DRAFT_COLS.map(c => `<th>${c.label}</th>`).join('')}<th style="width:70px">操作</th></tr></thead>
      <tbody>${rows.map((r, i) => draftRowHtml(r, i)).join('') || '<tr><td colspan="20" class="empty">暂无编写中的用例：可「添加空行」手工编写，或「外部导入」「用例库导入」</td></tr>'}</tbody></table>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeAllModals()">关闭</button>
      <button class="btn btn-primary" id="dkSubmit">提交审批</button>
    </div>`;
}
function bindDraftPage() {
  $$('.df').forEach(el => el.oninput = el.onchange = () => {
    const r = DB.draftCases[+el.dataset.idx];
    if (!r) return;
    r[el.dataset.k] = el.value;
    if (el.dataset.k === 'autoFlag') renderDraft();
  });
  const cnt = () => { if ($('#draftCount')) $('#draftCount').textContent = (DB.draftCases || []).length; };
  if ($('#dkAdd')) $('#dkAdd').onclick = () => addDraftRow();
  if ($('#dkDel')) $('#dkDel').onclick = () => removeDraftRows();
  if ($('#dkClear')) $('#dkClear').onclick = () => { DB.draftCases = []; renderDraft(); };
  if ($('#dkExternal')) $('#dkExternal').onclick = () => importExternal();
  if ($('#dkFromStd')) $('#dkFromStd').onclick = () => importFromStd();
  if ($('#dkSubmit')) $('#dkSubmit').onclick = () => submitDraft();
  cnt();
}
function renderDraft() {
  const backs = $$('.modal-backdrop');
  const box = backs.length ? backs[backs.length - 1] : null;
  if (!box) { openDraft(); return; }
  const body = box.querySelector('.modal-body');
  body.innerHTML = draftPageHtml();
  bindDraftPage();
}
window.openDraft = function () {
  if (!guard('edit')) return;
  closeAllModals();
  modal('用例编写 · 新建用例集', draftPageHtml());
  const backs = $$('.modal-backdrop');
  if (backs.length) backs[backs.length - 1].querySelector('.modal').style.width = 'min(1680px, 97vw)';
  bindDraftPage();
};
window.importCases = function () { openDraft(); };
window.addDraftRow = function () {
  DB.draftCases = DB.draftCases || [];
  DB.draftCases.push({ branch: '产品通用', domain: '固件', level: 'L3', source: '需求', testType: '功能测试', autoFlag: '否', testPoint: '人机交互', input: '无', remark: '无' });
  renderDraft();
  toast('已添加空行，请填写用例内容');
};
window.removeDraftRow = function (i) { DB.draftCases.splice(i, 1); renderDraft(); };
window.removeDraftRows = function () {
  const picks = $$('.dchk:checked').map(c => +c.dataset.idx);
  if (!picks.length) { toast('请先勾选要删除的行'); return; }
  DB.draftCases = DB.draftCases.filter((r, i) => !picks.includes(i));
  renderDraft(); toast(`已删除 ${picks.length} 行`);
};
/* 外部导入（Excel）：选择 .xlsx 文件 → 解析为编写页草稿行 */
window.importExternal = function () {
  if (!guard('edit', '导入用例')) return;
  modal('外部导入用例（Excel）', `
    
    <div class="field"><label>选择 Excel 文件（.xlsx）</label><input type="file" id="impFile" accept=".xlsx"></div>
    <div class="hint" style="margin:6px 0 0"><span class="link" onclick="downloadStdTemplate()">下载导入模板</span></div>
    <div class="hint" style="margin:6px 0 0" id="impTip"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="impOk">导入到编写页</button>
    </div>`);
  $('#impFile').onchange = e => {
    const f = e.target.files[0];
    $('#impTip').textContent = f ? `已选择：${f.name}` : '';
  };
  $('#impOk').onclick = async () => {
    const f = $('#impFile').files[0];
    if (!f) { toast('请先选择 Excel 文件'); return; }
    try {
      const sheets = await XLSX_LITE.read(await f.arrayBuffer());
      const rows = (sheets[0] && sheets[0].rows) || [];
      const r = draftRowsFromExcel(rows);
      if (!r.rows.length) { toast(r.errors[0] || '未解析到有效用例', 'error'); return; }
      /* 提前提示：表格里的功能模块若不在模块划分表中，提交审批时才会自动登记 */
      const newMods = Array.from(new Set(r.rows.map(x => x.module))).filter(m => !DB.stdModules.some(x => x.name === m));
      DB.draftCases = (DB.draftCases || []).concat(r.rows);
      /* 导入留痕：文件名 / 条数 / 落点（编写页草稿），便于核对是谁、何时、从哪个文件导入了多少条 */
      log('导入模块用例（Excel）', `${f.name}｜解析 ${r.rows.length} 条 → 编写页草稿${r.skipped ? `｜跳过 ${r.skipped} 条` : ''}`
        + `${newMods.length ? `｜含新功能模块 ${newMods.slice(0, 5).join('、')}${newMods.length > 5 ? ' 等' : ''}` : ''}`
        + `｜用例概述示例 ${r.rows.slice(0, 2).map(x => briefLogText(x.summary, 20)).join('、') || '—'}`,
        '', { module: '导入导出', objType: '导入文件', objId: f.name });
      closeTopModal(); renderDraft();
      toast(`已导入 ${r.rows.length} 条用例到编写页${r.skipped ? `（跳过 ${r.skipped} 条）` : ''}`
        + (newMods.length ? `；${newMods.slice(0, 2).join('、')}${newMods.length > 2 ? ' 等' : ''} 不在模块划分表中，提交审批时自动纳入` : '')
        + '；提交审批后才进入模块用例库', 'success');
    } catch (err) {
      toast('解析失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    }
  };
};
/* Excel 导入的行 → 编写页草稿行的转换见 draftRowsFromExcel（已统一为 xlsx，不再支持 CSV / 粘贴） */
/* 用例库导入：从模块用例库挑选已有用例导入到编写页（复制为新行） */
window.importFromStd = function () {
  const mods = Array.from(new Set(DB.stdCases.map(c => c.module)));
  modal('用例库导入', `
    
    <div class="toolbar" style="box-shadow:none;margin-bottom:10px">
      <div><label>功能模块</label><select id="ifMod"><option value="">全部</option>${mods.map(m => `<option>${m}</option>`).join('')}</select></div>
      <div><label>关键字</label><input id="ifKw" placeholder="用例编号 / 用例概述"></div>
      <button class="btn btn-ghost btn-sm" id="ifSearch">搜索</button>
      <span class="chip" id="ifCount"></span>
    </div>
    <div class="table-wrap" style="max-height:46vh" id="ifList"></div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="ifOk">导入选中用例</button>
    </div>`);
  const draw = () => {
    const mod = $('#ifMod').value, kw = $('#ifKw').value.trim();
    const list = DB.stdCases.filter(c => (!mod || c.module === mod) && (!kw || c.id.includes(kw) || (c.summary || '').includes(kw))).slice(0, 300);
    $('#ifCount').textContent = `匹配 ${list.length} 条`;
    $('#ifList').innerHTML = list.length ? `<table><thead><tr><th style="width:44px">选择</th><th>用例编号</th><th>功能模块</th><th>分支类型</th><th>等级</th><th>用例概述</th><th>状态</th></tr></thead>
      <tbody>${list.map(c => `<tr><td><input type="checkbox" class="ifchk" value="${c.id}"></td>
        <td>${stdCaseNoLabel(c)}</td><td>${c.module}</td><td>${c.branch}</td><td>${c.level}</td><td style="white-space:normal">${c.summary}</td><td>${pill(c.status)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">没有符合条件的用例</div>';
  };
  $('#ifSearch').onclick = draw;
  $('#ifMod').onchange = draw;
  $('#ifKw').onkeydown = e => { if (e.key === 'Enter') draw(); };
  draw();
  $('#ifOk').onclick = () => {
    const picks = $$('.ifchk:checked').map(c => c.value);
    if (!picks.length) { toast('请勾选要导入的用例'); return; }
    const rows = picks.map(id => {
      const c = DB.stdCases.find(x => x.id === id) || {};
      return {
        module: c.module, branch: c.branch || '产品通用', domain: c.domain || stdDomainOf(c), level: c.level || 'L3', source: '需求',
        testType: c.testType || '功能测试', functionPoint: c.functionPoint || '', testPoint: c.testPoint || '人机交互',
        summary: c.summary || '', pre: c.pre || '', steps: c.steps || '', input: c.input || '无', expect: c.expect || '',
        remark: c.remark || '无', minutes: c.minutes || '', autoFlag: c.autoFlag || '否', autoTool: c.autoTool || '', autoTime: c.autoTime || '',
        fromCase: id
      };
    });
    DB.draftCases = (DB.draftCases || []).concat(rows);
    log('从用例库导入到编写页', `${rows.length} 条｜源用例 ${picks.slice(0, 8).join('、')}${picks.length > 8 ? ' …' : ''}（副本，可编辑后重新提交审批）`,
      '', { module: '用例库', objType: '编写页草稿', objId: picks.join(',') });
    closeTopModal(); renderDraft();
    toast(`已从用例库导入 ${rows.length} 条到编写页（源用例编号已记录）`, 'success');
  };
};
/* 提交审批：字段校验（定位问题行）→ 选审批人 + 截止时间 → 生成用例编号并进入审核流程 */
window.submitDraft = function () {
  if (!guard('reviewCreate', '发起审核')) return;
  const rows = DB.draftCases || [];
  if (!rows.length) { toast('编写页暂无用例，请先添加或导入'); return; }
  let bad = 0;
  rows.forEach((r, i) => {
    const miss = DRAFT_REQUIRED.filter(k => !String(r[k] == null ? '' : r[k]).trim());
    if (!r.summary || !String(r.summary).trim()) miss.push('summary');
    r.__error = miss.length ? `第 ${i + 1} 条：${miss.map(k => (DRAFT_COLS.find(c => c.k === k) || { label: k }).label).join('、')} 不能为空` : '';
    if (r.__error) bad++;
  });
  renderDraft();
  if (bad) {
    const first = rows.find(r => r.__error);
    const idx = rows.indexOf(first);
    const el = document.querySelector(`tr[data-row="${idx}"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); }
    toast(`共 ${bad} 条用例不符合规范，已高亮问题行并定位到第 ${idx + 1} 条：${first.__error.replace(/^第 \d+ 条：/, '')}`, 'error');
    return;
  }
  const approvers = Array.from(new Set((DB.roles || []).filter(r => r.name === '一级' || r.name === '最高管理员').flatMap(r => r.users || []).concat(DB.deptMembers)));
  modal('提交审批（用例入库流程）', `
    
    <table class="detail-table">
      <tr><td style="width:110px">审批人：</td><td><div class="multi" id="apBox">${approvers.map(a => `<label><input type="checkbox" class="apchk" value="${a}" ${a === DB.currentUser ? 'checked' : ''}> ${a}</label>`).join('')}</div></td></tr>
      <tr><td>审核截止时间：</td><td><input id="apDeadline" type="datetime-local" value="${today()}T18:00"></td></tr>
      <tr><td>提交说明：</td><td><input id="apNote" style="width:100%" value="本次提交 ${rows.length} 条模块用例，请审核入库。"></td></tr>
    </table>
    <div class="form-actions">
      <span class="hint" style="margin:0" id="apTip"></span>
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="apOk">提交</button>
    </div>`);
  const sync = () => { $('#apTip').textContent = `已选审批人 ${$$('.apchk:checked').length} 人`; };
  $$('.apchk').forEach(c => c.onchange = sync);
  sync();
  $('#apOk').onclick = () => {
    const picked = $$('.apchk:checked').map(c => c.value);
    if (!picked.length) { toast('请至少选择一位审批人'); return; }
    const deadline = ($('#apDeadline').value || '').slice(0, 10) || addWorkDays(today(), 1);
    /* 写入模块用例库（状态：新增）；未审核通过的用例不占用正式编号，用「待编号」占位（审核通过时才生成编号），
       否则每次提交 / 回退 / 重新提交都会烧掉一个序号。回退用例重新提交时更新原用例 */
    const ids = [];
    /* 提交时把不在模块划分表中的功能模块自动纳入（与「新建模块用例」表单一致）：
       Excel 导入 / 用例库导入 / 手工填写的自定义模块名，若只写库不登记模块，
       左侧「模块用例库结构」只按模块划分表渲染，就会出现「用例在库、结构树看不到」的问题 */
    const addedMods = [];
    rows.forEach(r => { if (ensureModuleExists(r.module, normDomain(r.domain, '固件'), '用例编写提交审批')) addedMods.push(r.module); });
    rows.forEach(r => {
      if (r.editCase) {
        const c = DB.stdCases.find(x => x.id === r.editCase);
        if (c) {
          const before = Object.assign({}, c);
          Object.assign(c, {
            level: r.level || c.level, module: r.module, branch: r.branch || c.branch,
            functionPoint: r.functionPoint, testPoint: r.testPoint || c.testPoint, summary: r.summary,
            pre: r.pre, steps: r.steps, input: r.input, expect: r.expect, remark: r.remark || '无', minutes: r.minutes || '',
            domain: normDomain(r.domain, c.domain),
            source: r.source || c.source, testType: r.testType || c.testType, testProject: r.testProject || r.module,
            autoFlag: r.autoFlag || '否',
            autoTool: r.autoFlag === '是' ? (r.autoTool || '—') : '—',
            autoTime: r.autoFlag === '是' ? (r.autoTime || '—') : '—',
            autoUpdatedAt: r.autoFlag === '是' ? today() : '—',
            status: '新增', returnReason: '', returnDate: '', returnTo: '',
            updater: DB.currentUser, updateDate: today()
          });
          const diff = diffCaseFields(before, c);
          c.historyLog = `${before.historyLog || ''}；${today()} 由 ${DB.currentUser} 修改后重新提交审核：${diff || '无字段变化'}（${isPendingCaseId(c.id) ? '未审核通过期间编号保持「待编号」，审批通过后按审批通过时间生成正式编号' : `原编号 ${c.id} 保留，审批通过后按审批通过时间生成新编号`}）`;
          c.log = `${before.log || ''}；${today()} 修改并重新提交（${DB.currentUser}）`;
          ids.push(c.id);
          return;
        }
      }
      const id = nextPendingCaseId();
      ids.push(id);
      const branchText = normBranch(r.branch || '产品通用');
      DB.stdCases.unshift({
        id, level: r.level || 'L3', module: r.module, branch: branchText,
        domain: normDomain(r.domain, normDomain((DB.stdModules.find(m => m.name === r.module) || {}).domain, '固件')),
        functionPoint: r.functionPoint, testPoint: r.testPoint || '人机交互', summary: r.summary,
        designer: DB.currentUser, status: '新增',
        refProducts: branchText === '指定产品' ? splitList(r.refProducts || '') : [],
        pre: r.pre, steps: r.steps, input: r.input, expect: r.expect, remark: r.remark || '无', minutes: r.minutes || '',
        source: r.source || '需求', testType: r.testType || '功能测试', testProject: r.testProject || r.module, reuse: 0,
        marketBug: r.marketBug || '', marketBugDate: r.marketBugDate || '',
        autoFlag: r.autoFlag || '否',
        autoTool: r.autoFlag === '是' ? (r.autoTool || '—') : '—',
        autoTime: r.autoFlag === '是' ? (r.autoTime || '—') : '—',
        autoUpdatedAt: r.autoFlag === '是' ? today() : '—',
        bugCount: 0, bugIds: [], marketBug: '', marketBugDate: '',
        designDate: today(), updater: DB.currentUser, updateDate: today(),
        historyLog: `${today()} 由 ${DB.currentUser} 通过「用例编写 → 提交审批」创建（状态：新增，待审核入库；未审核通过期间不占用正式编号，显示「待编号」，审核通过后按审批通过时间生成正式编号）`,
        log: `首次创建：新增（${DB.currentUser}）`,
        fromCase: r.fromCase || ''
      });
    });
    const mods = Array.from(new Set(rows.map(r => r.module)));
    const rid = `MRV-2026-${String((DB.moduleReviews || []).length + 21).padStart(4, '0')}`;
    DB.moduleReviews.unshift({
      id: rid, type: '测试用例',
      target: `${mods.slice(0, 3).join('、')}${mods.length > 3 ? ' 等' : ''}（新建用例 ${ids.length} 条）`,
      module: mods[0], submitter: DB.currentUser, submitDate: today(), deadline,
      scope: '部门内（模块用例审核）', status: '待审核', participants: picked, opinions: [],
      caseIds: ids, note: $('#apNote').value.trim()
    });
    /* 企业微信提醒（演示：按期限剩余天数生成提醒记录） */
    DB.notices = DB.notices || [];
    const left = daysToDeadline(deadline);
    DB.notices.unshift({ time: nowStr(), to: picked.join('、'), type: '审核截止提醒', content: `用例审核 ${rid} 截止时间 ${deadline}（剩余 ${left} 天），将在剩余 48/24/12 小时节点推送企业微信消息` });
    DB.draftCases = [];
    log('提交用例审核', `${rid}｜${ids.length} 条用例（${stdCaseNoListLabel(ids.slice(0, 5))}${ids.length > 5 ? ' …' : ''}）｜审批人 ${picked.join('、')}｜截止 ${deadline}${addedMods.length ? `｜自动纳入新功能模块 ${addedMods.join('、')}` : ''}${ids.some(isPendingCaseId) ? '｜未审核通过不占用正式编号（编号待审核通过后生成）' : ''}`);
    closeAllModals(); state.tab = 'reviews'; state.reviewTab = 'module'; renderApp();
    toast(`已提交 ${ids.length} 条用例，生成审核单 ${rid}${ids.some(isPendingCaseId) ? '（编号将在审核通过后生成）' : ''}${addedMods.length ? `（自动纳入新功能模块：${addedMods.slice(0, 3).join('、')}${addedMods.length > 3 ? ' 等' : ''}）` : ''}`, 'success');
  };
};

/* 回退用例：从待办进入「修改并重新提交」（预填到用例编写页） */
window.resubmitReturnedCase = function (id) {
  const c = DB.stdCases.find(x => x.id === id);
  if (!c) return;
  DB.draftCases = [{
    editCase: c.id, module: c.module, branch: c.branch || '产品通用',
    domain: normDomain(c.domain, normDomain((DB.stdModules.find(m => m.name === c.module) || {}).domain, '固件')), level: c.level || 'L3',
    source: c.source || '需求', testType: c.testType || '功能测试', functionPoint: c.functionPoint || '',
    testPoint: c.testPoint || '人机交互', summary: c.summary || '', pre: c.pre || '', steps: c.steps || '',
    input: c.input || '无', expect: c.expect || '', remark: c.remark || '无', minutes: c.minutes || '',
    autoFlag: c.autoFlag || '否', autoTool: c.autoTool || '', autoTime: c.autoTime || ''
  }];
  log('回退用例载入编写页', `${stdCaseNoLabel(c)}｜${c.module}｜回退原因：${briefLogText(c.returnReason, 80) || '—'}`,
    '', { module: '用例库', objType: '模块用例', objId: c.id });
  openDraft();
  toast(`已载入回退用例 ${stdCaseNoLabel(c)}，修改后点「提交审批」重新提交`);
};

/* ================= 缺陷与市场问题（平台缺陷库 / 市场问题闭环） ================= */
const BUG_SOURCES = ['客户问题反馈', '研发自我提升', '日常测试工作', '抽样试验', '物料验证', '可靠性'];
const BUG_LEVELS = ['致命A', '严重B', '一般C', '微小D', '建议E'];
const BUG_PRIORITY = ['未知', '紧急重要', '重要不紧急', '紧急不重要', '不重要不紧急'];
const BUG_FREQ = ['必现', '经常', '偶现', '极低', '只出现一次'];
/* 缺陷单据所需字段 ← 用例管理平台字段获取位置（需求 3.5.2 字段对应关系） */
const BUG_FIELD_MAP = [
  ['Bug来源', '提交 Bug 时填写的「Bug来源」字段'],
  ['测试负责人', '使用当前登录系统人员姓名'],
  ['测试确认人', '创建测试执行任务时填写的「测试负责人」字段'],
  ['研发负责人', '创建测试执行任务时填写的「研发负责人」字段'],
  ['涉及领域', '创建测试执行任务时填写的「领域」字段'],
  ['硬件版本', '创建测试执行任务时填写的「硬件版本」字段'],
  ['固件版本', '创建测试执行任务时填写的「固件版本」字段'],
  ['BUG标题', '提交 Bug 时填写的「Bug标题」字段'],
  ['测试项目', '所使用测试用例的「测试项目」字段'],
  ['缺陷等级', '提交 Bug 时填写的「缺陷等级」字段'],
  ['缺陷优先级', '提交 Bug 时填写的「缺陷优先级」字段'],
  ['影响特性', '所使用测试用例的「测试类型」字段'],
  ['发起人', '使用当前登录系统人员姓名'],
  ['当前测试轮数', '创建测试执行任务时填写的「测试轮数」字段'],
  ['是否为新引入Bug', '提交 Bug 时填写的「是否为新引入Bug」字段'],
  ['产品定位', '创建项目任务时填写的「任务类型」字段'],
  ['产品经理', '创建项目任务时填写的「产品经理」字段'],
  ['产品名称', '创建测试执行任务时填写的「产品型号」字段'],
  ['Bug描述', '提交 Bug 时填写的「Bug描述」字段'],
  ['前置条件', '所使用测试用例的「前置条件」字段'],
  ['复现步骤', '所使用测试用例的「详细概述 / 操作步骤」字段'],
  ['复现频率', '提交 Bug 时填写的「复现频率」字段'],
  ['预期结果', '所使用测试用例的「预期结果 / 测试标准」字段'],
  ['实际结果', '提交 Bug 时填写的「实际结果」字段'],
  ['预期解决时间', '提交 Bug 时填写的「预期解决时间」字段']
];
window.openBugFieldMap = function () {
  modal('用例管理平台 → 平台缺陷库 字段对应关系', `
    
    <div class="table-wrap" style="max-height:60vh"><table>
      <thead><tr><th style="width:220px">缺陷单据所需字段</th><th>用例管理平台字段获取位置</th></tr></thead>
      <tbody>${BUG_FIELD_MAP.map(([a, b]) => `<tr><td><b>${a}</b></td><td style="white-space:normal">${b}</td></tr>`).join('')}</tbody></table></div>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeTopModal()">关闭</button></div>`);
};
window.bugDetail = function (id) {
  const b = (DB.bugs || []).concat(DB.marketBugs || []).find(x => x.id === id);
  if (!b) return;
  const d = {
    'BUG ID': b.id, 用例编号: b.caseId || '—', 所属产品: b.model || '—', 执行任务: b.execId || '—',
    Bug来源: b.source || '—', 缺陷等级: b.level, 缺陷优先级: b.priority || '—', 复现频率: b.freq || '—',
    Bug标题: b.title, 实际结果: b.actual || '—', Bug描述: b.desc || '—', '是否为新引入 Bug': b.isNew || '否',
    预期解决时间: b.expectFix || '—', 测试项目: b.testProject || '—', 影响特性: b.testType || '—',
    研发负责人: b.dev || '—', 测试负责人: b.tester || '—', 发起人: b.submitter, 提交日期: b.date,
    当前测试轮数: b.round || '—', 硬件版本: b.hwVersion || '—', 固件版本: b.fwVersion || '—',
    前置条件: b.pre || '—', 复现步骤: b.steps || '—', 预期结果: b.expect || '—', 状态: b.status
  };
  modal(`缺陷详情 · ${b.id}`, `
    <table class="detail-table">${Object.entries(d).map(([k, v]) => `<tr><td style="width:150px">${k}</td><td>${v == null ? '—' : v}</td></tr>`).join('')}</table>
    <div class="form-actions"><button class="btn btn-ghost" onclick="closeTopModal()">关闭</button>
      <button class="btn btn-primary" onclick="openBugFieldMap()">字段对应关系</button></div>`);
};

/* 市场问题反推用例：质控指定后由对接人填写用例信息 → 提交审核 → 通过后入库 */
window.rejectMarketCase = function (bugId) {
  if (!guard('edit')) return;
  const b = bugId ? (DB.marketBugs || []).find(x => x.id === bugId) : null;
  const mods = DB.stdModules.map(m => m.name);
  modal(`市场问题反推用例${b ? ' · ' + b.id : ''}`, `
    
    <div class="form" style="grid-template-columns:1.2fr .8fr .8fr">
      <div class="field"><label>功能模块</label><select id="rmModule">${mods.map(m => `<option ${b && b.module === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      <div class="field"><label>用例等级</label><select id="rmLevel">${['L1', 'L2', 'L3'].map(l => `<option ${l === 'L3' ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>测试点</label><input id="rmTestPoint" value="异常场景"></div>
    </div>
    <div class="form" style="grid-template-columns:1fr 1fr">
      <div class="field"><label>市场反馈 BUG</label><input id="rmBug" value="${b ? b.id : ''}" placeholder="市场问题流水号"></div>
      <div class="field"><label>功能点</label><input id="rmFunctionPoint" value="${b && b.module ? b.module : ''}"></div>
    </div>
    <div class="form" style="grid-template-columns:1fr">
      <div class="field"><label>用例概述</label><input id="rmSummary" value="${b ? b.title : ''}" placeholder="市场问题对应的验证场景"></div>
      <div class="field"><label>前置条件</label><textarea id="rmPre" rows="2">${b && b.pre ? b.pre : ''}</textarea></div>
      <div class="field"><label>详细概述 / 操作步骤</label><textarea id="rmSteps" rows="3">${b && b.steps ? b.steps : ''}</textarea></div>
      <div class="field"><label>输入数据</label><input id="rmInput" value="无"></div>
      <div class="field"><label>预期结果 / 测试标准</label><textarea id="rmExpect" rows="2">${b && b.expect ? b.expect : ''}</textarea></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-ghost" onclick="closeTopModal()">取消</button>
      <button class="btn btn-primary" id="rmOk">提交审核入库</button>
    </div>`);
  $('#rmOk').onclick = () => {
    const summary = $('#rmSummary').value.trim();
    if (!summary) { toast('请填写用例概述'); return; }
    const mod = $('#rmModule').value;
    const id = nextStdCaseId();
    DB.stdCases.unshift({
      id, level: $('#rmLevel').value, module: mod, branch: '产品通用',
      domain: normDomain('', normDomain((DB.stdModules.find(m => m.name === mod) || {}).domain, '固件')),
      functionPoint: $('#rmFunctionPoint').value.trim() || mod,
      testPoint: $('#rmTestPoint').value.trim(), summary, designer: DB.currentUser, status: '新增',
      pre: $('#rmPre').value, steps: $('#rmSteps').value, input: $('#rmInput').value, expect: $('#rmExpect').value, remark: '市场问题反推用例',
      source: '市场问题', testType: '功能测试', testProject: mod, reuse: 0, autoFlag: '否', autoTool: '—', autoTime: '—', autoUpdatedAt: '—',
      bugCount: 0, bugIds: [], marketBug: $('#rmBug').value.trim(), marketBugDate: today(),
      designDate: today(), updater: DB.currentUser, updateDate: today(),
      historyLog: `${today()} 由 ${DB.currentUser} 通过市场问题反推创建（状态：新增，待审核入库）`,
      log: `首次创建：新增（市场问题反推，${DB.currentUser}）`
    });
    /* 自动发起模块用例审核 */
    const rid = `MRV-2026-${String(DB.moduleReviews.length + 21).padStart(4, '0')}`;
    DB.moduleReviews.unshift({
      id: rid, type: '测试用例', target: `${mod} · 产品通用（市场问题反推 1 条）`, module: mod,
      submitter: DB.currentUser, submitDate: today(), deadline: addWorkDays(today(), 1), scope: '部门内（模块用例审核）',
      status: '待审核', participants: [], opinions: [], caseIds: [id]
    });
    log('市场问题反推用例', `${id}｜${mod}｜市场问题 ${$('#rmBug').value.trim() || '—'}｜已发起审核 ${rid}`);
    closeTopModal(); renderApp();
    toast(`用例 ${id} 已创建并提交审核（${rid}）`, 'success');
  };
};

/* ================= 启动：登录 / 注册 → 拉取服务端数据 → 渲染 ================= */
const LAST_USER_KEY = 'tmplatform.lastUser';
let LOGIN_MODE = 'login';    // login＝登录卡片；register＝注册卡片；forgot＝找回密码卡片
function loginCardHtml() {
  return `
    <div class="login-card">
      <div class="login-title">测试任务执行平台</div>
      <label>账号</label>
      <input id="lgName" autocomplete="username" placeholder="请输入账号，如 admin">
      <label>密码</label>
      <input id="lgPwd" type="password" autocomplete="current-password" placeholder="请输入密码">
      <div class="login-link-row"><span class="link" onclick="loginView('', 'forgot')">忘记密码？</span></div>
      <div class="login-err" id="lgErr"></div>
      <button class="btn btn-primary login-btn" id="lgOk">登录</button>
      <div class="login-foot">还没有账号？<span class="link" style="font-size:12px" onclick="loginView('', 'register')">注册新账号</span></div>
    </div>`;
}
/* 找回密码：账号 / 绑定邮箱 → 邮箱验证码 → 设置新密码 */
function forgotCardHtml() {
  return `
    <div class="login-card">
      <div class="login-title">找回密码</div>
      <label>账号或绑定邮箱</label>
      <input id="fgAccount" autocomplete="username" placeholder="账号名 或 注册时填写的邮箱">
      <label>邮箱验证码</label>
      <div class="code-row">
        <input id="fgCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位数字">
        <button class="btn btn-ghost" id="fgCodeBtn">获取验证码</button>
      </div>
      <label>新密码（至少 6 位）</label>
      <input id="fgPwd" type="password" autocomplete="new-password">
      <label>确认新密码</label>
      <input id="fgPwd2" type="password" autocomplete="new-password">
      <div class="login-err" id="fgErr"></div>
      <button class="btn btn-primary login-btn" id="fgOk">重置密码</button>
      <div class="login-foot">想起密码了？<span class="link" style="font-size:12px" onclick="loginView('', 'login')">返回登录</span></div>
    </div>`;
}
function registerCardHtml() {
  return `
    <div class="login-card">
      <div class="login-title">注册新账号</div>
      <label>邮箱</label>
      <div class="code-row">
        <input id="rgMail" type="email" autocomplete="email" placeholder="接收验证码的邮箱">
        <button class="btn btn-ghost" id="rgCodeBtn">获取验证码</button>
      </div>
      <label>邮箱验证码</label>
      <input id="rgCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 位数字">
      <label>账号（姓名 / 工号）</label>
      <input id="rgName" autocomplete="username" placeholder="2-20 位，中文 / 字母 / 数字">
      <label>密码（至少 6 位）</label>
      <input id="rgPwd" type="password" autocomplete="new-password">
      <label>确认密码</label>
      <input id="rgPwd2" type="password" autocomplete="new-password">
      <div class="login-err" id="rgErr"></div>
      <button class="btn btn-primary login-btn" id="rgOk">注册</button>
      <div class="login-foot">已有账号？<span class="link" style="font-size:12px" onclick="loginView('', 'login')">返回登录</span></div>
    </div>`;
}
function bindLoginCard(mask) {
  if (LOGIN_MODE === 'register') {
    mask.querySelector('#rgOk').onclick = () => doRegister();
    mask.querySelector('#rgCodeBtn').onclick = () => sendRegisterCode();
    mask.querySelector('#rgCode').onkeydown = e => { if (e.key === 'Enter') mask.querySelector('#rgName').focus(); };
    mask.querySelector('#rgMail').onkeydown = e => { if (e.key === 'Enter') sendRegisterCode(); };
    mask.querySelector('#rgPwd2').onkeydown = e => { if (e.key === 'Enter') doRegister(); };
    mask.querySelector('#rgName').onkeydown = e => { if (e.key === 'Enter') mask.querySelector('#rgPwd').focus(); };
    return;
  }
  if (LOGIN_MODE === 'forgot') {
    mask.querySelector('#fgOk').onclick = () => doForgot();
    mask.querySelector('#fgCodeBtn').onclick = () => sendForgotCode();
    mask.querySelector('#fgAccount').onkeydown = e => { if (e.key === 'Enter') sendForgotCode(); };
    mask.querySelector('#fgCode').onkeydown = e => { if (e.key === 'Enter') mask.querySelector('#fgPwd').focus(); };
    mask.querySelector('#fgPwd2').onkeydown = e => { if (e.key === 'Enter') doForgot(); };
    return;
  }
  const submit = () => doLogin();
  mask.querySelector('#lgOk').onclick = submit;
  mask.querySelector('#lgPwd').onkeydown = e => { if (e.key === 'Enter') submit(); };
  mask.querySelector('#lgName').onkeydown = e => { if (e.key === 'Enter') mask.querySelector('#lgPwd').focus(); };
}
function loginView(msg, mode) {
  if (mode) LOGIN_MODE = mode;
  let mask = document.getElementById('loginMask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'loginMask';
    mask.className = 'login-mask';
    document.body.appendChild(mask);
  }
  /* 只有「首次打开 / 登录与注册视图切换」才重绘，避免登录失败时清空用户已输入的账号 */
  const needRender = !mask.querySelector('.login-card') || mask.dataset.mode !== LOGIN_MODE;
  if (needRender) {
    mask.dataset.mode = LOGIN_MODE;
    mask.innerHTML = LOGIN_MODE === 'register' ? registerCardHtml()
      : (LOGIN_MODE === 'forgot' ? forgotCardHtml() : loginCardHtml());
    bindLoginCard(mask);
  }
  if (msg) {
    const err = mask.querySelector('.login-err');
    if (err) err.textContent = msg;
  }
  if (LOGIN_MODE === 'register') {
    const rg = mask.querySelector('#rgName');
    if (rg && !rg.value) rg.focus();
    return;
  }
  if (LOGIN_MODE === 'forgot') {
    const fa = mask.querySelector('#fgAccount');
    if (fa && !fa.value) fa.focus();
    return;
  }
  const nameEl = mask.querySelector('#lgName');
  const pwdEl = mask.querySelector('#lgPwd');
  let last = '';
  try { last = localStorage.getItem(LAST_USER_KEY) || ''; } catch (e) { }
  if (last && !nameEl.value) nameEl.value = last;
  (last ? pwdEl : nameEl).focus();
}
/* 发送邮箱验证码（60 秒倒计时；调试模式下后端直接返回验证码并自动填入） */
async function sendRegisterCode() {
  const mask = document.getElementById('loginMask');
  if (!mask) return;
  const mail = (mask.querySelector('#rgMail').value || '').trim();
  const errEl = mask.querySelector('#rgErr');
  const btn = mask.querySelector('#rgCodeBtn');
  const re = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!re.test(mail)) { errEl.textContent = '请填写正确的邮箱地址'; return; }
  if (btn.disabled) return;
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = '发送中…';
  try {
    const r = await API.sendRegisterCode(mail);
    if (r && r.code) {
      mask.querySelector('#rgCode').value = r.code;
      toast('调试模式：验证码已自动填入', 'success');
    } else {
      toast('验证码已发送，请查收 ' + mail, 'success');
    }
    let left = 60;
    btn.textContent = `${left}s 后重发`;
    const timer = setInterval(() => {
      left -= 1;
      if (!btn.isConnected) { clearInterval(timer); return; }
      if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = '获取验证码'; return; }
      btn.textContent = `${left}s 后重发`;
    }, 1000);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '获取验证码';
    errEl.textContent = e.offline ? '无法连接服务器：请先启动后端（node server/index.js）' : (e.message || '验证码发送失败');
  }
}
/* 自助注册（需邮箱验证码）：成功后自动切回登录卡片并预填账号 */
async function doRegister() {
  const mask = document.getElementById('loginMask');
  if (!mask) return;
  const mail = (mask.querySelector('#rgMail').value || '').trim();
  const code = (mask.querySelector('#rgCode').value || '').trim();
  const name = (mask.querySelector('#rgName').value || '').trim();
  const pwd = mask.querySelector('#rgPwd').value || '';
  const pwd2 = mask.querySelector('#rgPwd2').value || '';
  const errEl = mask.querySelector('#rgErr');
  const btn = mask.querySelector('#rgOk');
  const re = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (!re.test(mail)) { errEl.textContent = '请填写正确的邮箱地址'; return; }
  if (!/^\d{6}$/.test(code)) { errEl.textContent = '请填写 6 位邮箱验证码'; return; }
  if (!name || !pwd) { errEl.textContent = '请填写账号与密码'; return; }
  if (name.length < 2 || name.length > 20) { errEl.textContent = '账号长度需 2-20 位'; return; }
  if (pwd.length < 6) { errEl.textContent = '密码至少 6 位'; return; }
  if (pwd !== pwd2) { errEl.textContent = '两次输入的密码不一致'; return; }
  btn.disabled = true;
  btn.textContent = '注册中…';
  try {
    await API.register(name, pwd, mail, code);
    try { localStorage.setItem(LAST_USER_KEY, name); } catch (e) { }
    loginView(`账号「${name}」注册成功，请使用新密码登录`, 'login');
    const nameEl = document.getElementById('lgName');
    if (nameEl) nameEl.value = name;
    const pwdEl = document.getElementById('lgPwd');
    if (pwdEl) pwdEl.focus();
  } catch (e) {
    errEl.textContent = e.offline ? '无法连接服务器：请先启动后端（node server/index.js）' : (e.message || '注册失败');
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = '注册';
    }
  }
}
/* 找回密码：向账号绑定邮箱发送验证码 */
async function sendForgotCode() {
  const mask = document.getElementById('loginMask');
  if (!mask) return;
  const who = (mask.querySelector('#fgAccount').value || '').trim();
  const errEl = mask.querySelector('#fgErr');
  const btn = mask.querySelector('#fgCodeBtn');
  if (!who) { errEl.textContent = '请先填写账号或绑定邮箱'; mask.querySelector('#fgAccount').focus(); return; }
  if (btn.disabled) return;
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = '发送中…';
  try {
    const r = await API.findPwdCode(who);
    if (r && r.code) {
      mask.querySelector('#fgCode').value = r.code;
      toast('调试模式：验证码已自动填入', 'success');
    } else {
      toast('验证码已发送至 ' + ((r && r.email) || '账号绑定邮箱'), 'success');
    }
    let left = 60;
    btn.textContent = `${left}s 后重发`;
    const timer = setInterval(() => {
      left -= 1;
      if (!btn.isConnected) { clearInterval(timer); return; }
      if (left <= 0) { clearInterval(timer); btn.disabled = false; btn.textContent = '获取验证码'; return; }
      btn.textContent = `${left}s 后重发`;
    }, 1000);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '获取验证码';
    errEl.textContent = e.offline ? '无法连接服务器：请先启动后端（node server/index.js）' : (e.message || '验证码发送失败');
  }
}
/* 找回密码：校验验证码并重设口令，成功后回到登录卡片 */
async function doForgot() {
  const mask = document.getElementById('loginMask');
  if (!mask) return;
  const who = (mask.querySelector('#fgAccount').value || '').trim();
  const code = (mask.querySelector('#fgCode').value || '').trim();
  const pwd = mask.querySelector('#fgPwd').value || '';
  const pwd2 = mask.querySelector('#fgPwd2').value || '';
  const errEl = mask.querySelector('#fgErr');
  const btn = mask.querySelector('#fgOk');
  if (!who) { errEl.textContent = '请填写账号或绑定邮箱'; return; }
  if (!/^\d{6}$/.test(code)) { errEl.textContent = '请填写 6 位邮箱验证码'; return; }
  if (pwd.length < 6) { errEl.textContent = '新密码至少 6 位'; return; }
  if (pwd !== pwd2) { errEl.textContent = '两次输入的密码不一致'; return; }
  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    const r = await API.findPwdReset(who, code, pwd);
    const name = (r && r.name) || who;
    try { localStorage.setItem(LAST_USER_KEY, name); } catch (e) { }
    loginView(`账号「${name}」密码已重置，请使用新密码登录`, 'login');
    const nameEl = document.getElementById('lgName');
    if (nameEl) nameEl.value = name;
    const pwdEl = document.getElementById('lgPwd');
    if (pwdEl) pwdEl.focus();
  } catch (e) {
    errEl.textContent = e.offline ? '无法连接服务器：请先启动后端（node server/index.js）' : (e.message || '重置失败');
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      btn.textContent = '重置密码';
    }
  }
}
async function doLogin() {
  const nameEl = document.getElementById('lgName');
  const pwdEl = document.getElementById('lgPwd');
  const errEl = document.getElementById('lgErr');
  const btn = document.getElementById('lgOk');
  const name = (nameEl.value || '').trim();
  const pwd = pwdEl.value || '';
  if (!name || !pwd) { errEl.textContent = '请填写账号与密码'; return; }
  btn.disabled = true;
  btn.textContent = '登录中…';
  try {
    const r = await API.login(name, pwd);
    API.setToken(r.token);
    SESSION = r.user;
    try { localStorage.setItem(LAST_USER_KEY, name); } catch (e) { }
    const mask = document.getElementById('loginMask');
    if (mask) mask.remove();
    await bootAfterLogin();
  } catch (e) {
    errEl.textContent = e.offline ? '无法连接服务器：请先启动后端（node server/index.js）' : (e.message || '登录失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '登录';
  }
}
let APP_STARTED = false;
/* 服务不可达时用本地缓存兜底，避免整页不可用 */
function useCacheOffline(msg) {
  const cached = load();
  if (!cached) { loginView(msg); return false; }
  DB = cached;
  SYNC.online = false;
  toast(msg || '无法连接服务器，当前展示本机缓存数据', 'error');
  startApp();
  return true;
}
async function bootAfterLogin() {
  let r;
  try {
    r = await API.getState();
  } catch (e) {
    if (e.unauthorized) { loginView('登录已过期，请重新登录'); return; }
    useCacheOffline(e.message);
    return;
  }
  if (r && r.state) {
    DB = r.state;
    SYNC.version = r.version;
    SYNC.base = stateClone(r.state);
  } else {
    /* 首次使用：以空白基线初始化（只含账号 / 角色 / 权限，无任何业务数据）并写入服务端 */
    DB = blankDB();
    DB.currentUser = (SESSION && SESSION.name) || DB.currentUser;
    const snap = stateForServer();
    try {
      const w = await API.putState(r ? r.version : 0, snap);
      SYNC.version = w.version;
      SYNC.base = stateClone(snap);
    } catch (e) { /* 写不进去也先让用户使用，后续保存会重试 */ }
  }
  startApp();
  log('登录平台', `${DB.currentUser} 登录（角色 ${DB.currentRole}）`, '', { module: '系统' });
  /* 管理员创建 / 口令被重置的账号：首登提醒改口令 */
  if (SESSION && SESSION.mustChange) {
    toast('当前账号仍在使用初始口令，请尽快在头像菜单 →「个人账号设置」中修改', 'error');
  }
}
function startApp() {
  DB.currentUser = (SESSION && SESSION.name) || DB.currentUser;
  /* 角色以登录时后端账号表返回的为准（自助注册账号默认三级），其次看角色成员表 */
  DB.currentRole = (SESSION && SESSION.role) || roleOf(DB.currentUser) || DB.currentRole;
  if (!DB.tasks) DB.tasks = [];
  if (!DB.stdCases) DB.stdCases = [];
  migrateDB();
  migrateEmptyExecResult();
  state.cols = loadCols();
  /* 恢复上次所在页面（页签 / 审核子页 / 产品 / 任务），刷新不再跳回首页 */
  restoreView();
  const bootExecId = (state.execCase || {}).execId || '';
  renderApp();
  /* 上次停留在「用例执行明细页」：渲染完外壳后回到该页（执行任务已被删除则留在任务页） */
  if (bootExecId && (DB.execTasks || []).some(e => e.execId === bootExecId)) {
    state.execCase = { execId: bootExecId, page: 1, size: 20, filters: {}, scope: 'all', sortBy: 'default' };
    renderHeader();
    renderExecCases();
  }
  if (!APP_STARTED) {
    APP_STARTED = true;
    /* 通用下拉增强：页面与弹窗中的所有原生下拉框 → 关键字搜索下拉 */
    initSelectEnhancer();
    /* 表格列宽自适应：局部重绘 / 弹窗 / 窗口缩放后自动重算列宽 */
    initTableFit();
    /* 执行结果的离线缓存 / 服务端同步监听：网络或服务端恢复后自动补传本地缓存的变更 */
    startSyncWatcher();
  }
  /* 多人协作：空闲时自动拉取其他人的最新改动 */
  startAutoPull();
  if (SYNC.online) markOnline();
}
(async function boot() {
  if (!API.getToken()) { loginView(); return; }
  let me;
  try {
    me = await API.me();
  } catch (e) {
    if (e.offline) { useCacheOffline('无法连接服务器，当前展示本机缓存数据'); return; }
    loginView(e.message);
    return;
  }
  SESSION = me.user;
  await bootAfterLogin();
})();
