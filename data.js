/* 用例管理平台原型数据：模块用例库（标准库）+ 产品用例库 + 库间关联 + 任务引用 + 双轨审核 */

const mock = {
  /* ---------- 顶层导航 ---- */
  nav: [
    { id: 'std', label: '模块用例库' },
    { id: 'prod', label: '产品用例库' },
    { id: 'tasks', label: '执行任务' },
    { id: 'reviews', label: '审核中心' }
  ],

  /* ---------- 模块用例库（标准库）：以「功能模块 + 分支」组织 ---------- */
  stdModules: [
    { name: '心跳包', domain: '固件', owner: '李英文' },
    { name: '指示灯', domain: '固件', owner: '刘增通' },
    { name: '低功耗休眠', domain: '固件', owner: '李英文' },
    { name: '4G 拨号', domain: '固件', owner: '刘增通' },
    { name: '硬件看门狗', domain: '硬件', owner: '曹银凤' }
  ],

  /* 当前登录用户（平台唯一的管理员账号） */
  currentUser: 'admin',

  /* 产品项目成员（产品用例审核参会范围 = 项目内相关人员） */
  productMembers: {
    'USR-ISG1008': ['曹银凤', '李英文', '刘志松', '秦文都', '魏勇', '李效明'],
    'USR-G780 V2': ['刘增通', '刘伟', '马方方', '魏勇', '李效明']
  },

  stdStats: [
    { category: '硬件', total: 554, normal: 554, disabled: 0, reused: 229 },
    { category: '固件', total: 10817, normal: 10685, disabled: 132, reused: 6796 }
  ],

  stdCases: [
    { id: 'UT2026041626211', level: 'L3', module: '指示灯', branch: '产品通用', functionPoint: '电源状态指示灯（POW）', testPoint: '人机交互', summary: '设备上电指示灯', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2'] },
    { id: 'UT2026041626210', level: 'L3', module: '指示灯', branch: '产品通用', functionPoint: '电源状态指示灯（POW）', testPoint: '人机交互', summary: '设备断电指示灯', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2'] },
    { id: 'UT2026041626209', level: 'L3', module: '指示灯', branch: '产品通用', functionPoint: '电源状态指示灯（POW）', testPoint: '人机交互', summary: '指示灯颜色验证', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2'] },
    { id: 'UT2026041626208', level: 'L3', module: '指示灯', branch: '产品通用', functionPoint: '设备工作状态指示灯（RUN）', testPoint: '人机交互', summary: '设备正常工作时指示灯', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2'] },
    { id: 'UT2026041626207', level: 'L3', module: '指示灯', branch: '产品通用', functionPoint: '设备工作状态指示灯（RUN）', testPoint: '人机交互', summary: '设备启动过程中指示灯', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2'] },
    { id: 'UT2026041626206', level: 'L3', module: '指示灯', branch: '产品通用', functionPoint: '设备工作状态指示灯（RUN）', testPoint: '人机交互', summary: '指示灯颜色验证', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2'] },
    { id: 'UT2026041626205', level: 'L3', module: '指示灯', branch: '产品通用', functionPoint: '设备工作状态指示灯（RUN）', testPoint: '人机交互', summary: '闪烁频率准确性', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2'] },
    { id: 'UT2026041626204', level: 'L3', module: '指示灯', branch: '产品通用', functionPoint: '设备工作状态指示灯（RUN）', testPoint: '人机交互', summary: '异常闪烁模式验证', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2'] },
    { id: 'UT2026041626203', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '网络指示灯（NET）', testPoint: '人机交互', summary: '不插入网线', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626202', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '网络指示灯（NET）', testPoint: '人机交互', summary: '插入网线后，以太网探测连接成功', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626201', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER1）', testPoint: '人机交互', summary: '串口无数据交互', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626200', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER1）', testPoint: '人机交互', summary: '串口发送数据', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626199', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER1）', testPoint: '人机交互', summary: '串口接收数据', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626198', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER2）', testPoint: '人机交互', summary: '串口无数据交互', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626197', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER2）', testPoint: '人机交互', summary: '串口发送数据', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626196', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER2）', testPoint: '人机交互', summary: '串口接收数据', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626195', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER3）', testPoint: '人机交互', summary: '串口无数据交互', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626194', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER3）', testPoint: '人机交互', summary: '串口发送数据', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626193', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER3）', testPoint: '人机交互', summary: '串口接收数据', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] },
    { id: 'UT2026041626192', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯（POER4）', testPoint: '人机交互', summary: '串口无数据交互', designer: '刘增通', status: '正常', refProducts: ['USR-ISG1008'] }
  ],

  stdCaseDetail: {
    用例编号: 'UT2026041626211',
    所属模块: '指示灯（FUNC-FW-002）',
    分支类型: '产品通用',
    领域: '固件',
    用例等级: 'L3',
    用例来源: '需求',
    设计者: '刘增通',
    设计日期: '2026-04-16',
    适用产品: 'USR-ISG1008 / USR-G780 V2',
    更新者: '刘增通',
    更新日期: '2026-09-28',
    测试类型: '易用性测试',
    测试项目: '指示灯',
    测试点: '人机交互',
    功能点: '电源状态指示灯（POW）',
    用例概述: '设备上电指示灯',
    前置条件: '1. 设备断电状态',
    详细概述操作步骤: '1. 给设备上电 2. 观察POW指示灯',
    输入数据: '无',
    预期结果测试标准: '1. POW指示灯红色常亮 2. 亮度符合规格要求',
    备注: '无',
    手动测试时间: '5',
    用例状态: '正常',
    复用次数: '4',
    被产品库引用: 'USR-ISG1008、USR-G780 V2（共 2 个产品库）',
    历史log: '2026-04-16新增；2026-09-28 随指示灯 V1.2 更新'
  },

  /* ---------- 产品用例库：按产品引用模块库用例 + 产品专属增补 ---------- */
  products: [
    {
      model: 'USR-ISG1008', series: 'USR-ISG', domain: '硬件', owner: '曹银凤',
      planVersion: 'V1.3', planDate: '2026-10-08', reviewStatus: '产品用例审核通过（项目内，2026-10-09）',
      refs: [
        { module: '指示灯', branch: '产品通用', date: '2026-09-28', count: 8 },
        { module: '指示灯', branch: '指定产品', date: '2026-09-28', count: 12 },
        { module: '硬件看门狗', branch: '产品通用', date: '2026-03-11', count: 8 },
        { module: '心跳包', branch: '产品通用', date: '2026-04-20', count: 6 }
      ],
      added: [
        { id: 'USR-ISG1008-A01', module: '低功耗休眠', summary: '休眠电流 ≤ 50uA', level: 'L2', date: '2026-10-08', reviewer: '曹银凤', feedback: '待回流确认' },
        { id: 'USR-ISG1008-A02', module: '低功耗休眠', summary: '休眠唤醒时间 ≤ 200ms', level: 'L3', date: '2026-10-08', reviewer: '曹银凤', feedback: '已回流（心跳包/低功耗分支 V1.1）' }
      ]
    },
    {
      model: 'USR-G780 V2', series: 'USR-G780', domain: '固件', owner: '刘增通',
      planVersion: 'V2.1', planDate: '2026-09-30', reviewStatus: '产品用例审核中（项目内）',
      refs: [
        { module: '指示灯', branch: '产品通用', date: '2026-09-28', count: 8 },
        { module: '指示灯', branch: '指定产品', date: '2026-06-10', count: 16 },
        { module: '心跳包', branch: '指定产品', date: '2026-04-20', count: 9 }
      ],
      added: [
        { id: 'USR-G780 V2-A01', module: '4G 拨号', summary: '弱信号下自动重拨成功率 ≥ 98%', level: 'L2', date: '2026-09-30', reviewer: '刘增通', feedback: '待回流确认' }
      ],
      /* 产品间引用：引用 USR-ISG1008 的产品用例，编号沿用被引用用例编号（不新增前缀） */
      prodRefs: [
        { fromModel: 'USR-ISG1008', caseIds: ['USR-ISG1008-A01'] }
      ]
    }
  ],

  /* ---------- 库间关联（模块库 ↔ 产品库）：引用关系由产品库 refs 实时推导 ---------- */
  lineageProdToStd: [
    { prodCase: 'USR-ISG1008-A01', product: 'USR-ISG1008', module: '低功耗休眠', summary: '休眠电流 ≤ 50uA', submitter: '曹银凤', submitDate: '2026-10-08', status: '待模块责任人确认', targetCase: '—' },
    { prodCase: 'USR-ISG1008-A02', product: 'USR-ISG1008', module: '低功耗休眠', summary: '休眠唤醒时间 ≤ 200ms', submitter: '曹银凤', submitDate: '2026-09-20', status: '已回流模块库', targetCase: 'UT2026092226301' },
    { prodCase: 'USR-G780 V2-A01', product: 'USR-G780 V2', module: '4G 拨号', summary: '弱信号下自动重拨成功率 ≥ 98%', submitter: '刘增通', submitDate: '2026-09-30', status: '待模块责任人确认', targetCase: '—' }
  ],

  /* ---------- 任务：引用产品用例库 ---------- */
  tasks: [
    { id: 'RW2026092100050', type: '常规任务', name: '2026年常规任务', pm: '刘志松', productManager: '李英文', contact: '秦文都', testLead: '曹银凤', finished: '否', caseSource: '产品用例库 · USR-ISG1008 V1.3' },
    { id: 'RW2026092100049', type: '项目任务', name: '机架式工控机-测试用', pm: '刘志松', productManager: '李英文', contact: '秦文都', testLead: '曹银凤', finished: '否', caseSource: '产品用例库 · 待关联' },
    { id: 'RW2026092000048', type: '常规任务', name: 'RS485集线器-测试用', pm: '李英文', productManager: '刘志松', contact: '李效明', testLead: '曹银凤', finished: '否', caseSource: '产品用例库 · 待关联' },
    { id: 'RW2026092000047', type: '物料验证', name: '高端路由器-测试用', pm: '李英文', productManager: '刘志松', contact: '秦文都', testLead: '曹银凤', finished: '否', caseSource: '产品用例库 · 待关联' },
    { id: 'RW2026092000046', type: '物料验证', name: '2026年物料验证', pm: '刘志松', productManager: '李英文', contact: '秦文都', testLead: '曹银凤', finished: '否', caseSource: '产品用例库 · 待关联' },
    { id: 'RW2026091700045', type: '项目任务', name: '五网口RedCap路由器', pm: '刘志松', productManager: '李英文', contact: '秦文都', testLead: '曹银凤', finished: '否', caseSource: '产品用例库 · 待关联' },
    { id: 'RW2026051400029', type: '项目任务', name: 'FQ310-SP', pm: '张洁', productManager: '刘伟', contact: '马方方', testLead: '李英文', finished: '否', caseSource: '产品用例库 · USR-FQ310-SP V2.0' },
    { id: 'RW2026041400023', type: '常规任务', name: '部门建设', pm: '刘志松', productManager: '马方方', contact: '李英文', testLead: '', finished: '否', caseSource: '产品用例库 · 待关联' },
    { id: 'RW2026040700022', type: '项目任务', name: 'FQ310-EP', pm: '张洁', productManager: '刘伟', contact: '马方方', testLead: '', finished: '否', caseSource: '产品用例库 · USR-FQ310-EP V1.8' },
    { id: 'RW2026030400019', type: '项目任务', name: '双路光纤CAN网关-二期', pm: '杨战东', productManager: '李雨佳', contact: '李英文', testLead: '', finished: '否', caseSource: '产品用例库 · 待关联' }
  ],
  taskDetail: {
    任务编号: 'RW2026092100050',
    任务类型: '常规任务',
    任务名称: '2026年常规任务',
    产品经理: '李英文',
    项目经理: '刘志松',
    接口人: '秦文都',
    测试主负责人: '曹银凤',
    是否完结: '',
    创建人: ''
  },
  executedTasks: [
    {
      execId: 'ZXRW2026092100159',
      name: 'USR-ISG1008硬件一轮',
      model: 'USR-ISG1008',
      domain: '硬件',
      round: 1,
      hwVersion: 'V1.1.00',
      fwVersion: 'V1.0.02.000000.0000',
      planned: 18,
      actual: '', passed: '', failed: '', blocked: '', notRun: '', diverged: '',
      executors: '曹银凤 魏勇 秦文都 李效明',
      workHours: '',
      caseSource: '产品用例库 · USR-ISG1008 V1.3（引用模块库 34 条 + 产品专属增补 2 条）'
    }
  ],
  taskLogs: [
    { taskId: 'RW2026092100050', execId: 'ZXRW2026092100159', time: '2026-09-29 15:52:14', operator: '李效明', action: '从产品用例库（USR-ISG1008 V1.3）添加 4 条用例' },
    { taskId: 'RW2026092100050', execId: 'ZXRW2026092100159', time: '2026-09-29 15:45:27', operator: '曹银凤', action: '从产品用例库（USR-ISG1008 V1.3）添加 4 条用例' },
    { taskId: 'RW2026092100050', execId: 'ZXRW2026092100159', time: '2026-09-29 15:45:04', operator: '曹银凤', action: '从产品用例库（USR-ISG1008 V1.3）添加 4 条用例' },
    { taskId: 'RW2026092100050', execId: 'ZXRW2026092100159', time: '2026-09-29 15:44:35', operator: '曹银凤', action: '从产品用例库（USR-ISG1008 V1.3）添加 6 条用例' },
    { taskId: 'RW2026092100050', execId: '', time: '2026-09-21 12:12:00', operator: 'oatest', action: '创建2026年常规任务' }
  ],

  /* ---------- 双轨审核 ---------- */
  deptMembers: ['admin'],

  /* ---------- 权限体系（可自定义：角色 × 权限项 × 成员） ---------- */
  /* 当前登录账号所属角色（演示用，可在「设置」中切换以模拟不同权限账号） */
  currentRole: '最高管理员',
  /* 权限项目录：按业务分组；k 为权限标识（与平台校验点一一对应），label / desc 为展示文案 */
  permCatalog: [
    { group: '用例库', items: [
      { k: 'view', label: '查看用例库', desc: '查看模块用例库 / 产品用例库' },
      { k: 'edit', label: '新建 / 导入用例', desc: '新建模块用例、编写页导入、产品专属增补' },
      { k: 'modify', label: '修改用例', desc: '修改用例内容与状态' },
      { k: 'disable', label: '停用 / 启用用例', desc: '停用或重新启用用例' },
      { k: 'export', label: '导出用例', desc: '导出需经有审批权限人员审批' },
      { k: 'manage', label: '用例管理', desc: '功能模块划分表、责任人设置、权限移交' }
    ] },
    { group: '审核', items: [
      { k: 'audit', label: '参与审核', desc: '模块用例审核 / 产品用例审核表决' },
      { k: 'reviewCreate', label: '发起审核', desc: '提交用例审核、发起产品用例审核、申请回流' }
    ] },
    { group: '任务与执行', items: [
      { k: 'task', label: '任务管理', desc: '创建 / 修改 / 删除任务与执行任务' },
      { k: 'exec', label: '任务执行', desc: '填写并保存执行结果、批量 pass' },
      { k: 'bug', label: '提交 Bug', desc: '执行页提交缺陷至平台缺陷库' }
    ] },
    { group: '页面访问', items: [
      { k: 'page.stats', label: '数据统计页' },
      { k: 'page.std', label: '模块用例库页' },
      { k: 'page.prod', label: '产品用例库页' },
      { k: 'page.tasks', label: '执行任务页' },
      { k: 'page.archive', label: '归档任务页' },
      { k: 'page.reviews', label: '审核中心页' },
      { k: 'page.perm', label: '设置页（仅最高管理员）' }
    ] },
    { group: '系统', items: [
      { k: 'delete', label: '删除数据', desc: '删除产品、任务等数据' },
      { k: 'roleManage', label: '角色与权限配置', desc: '自定义角色、勾选权限项、分配成员' }
    ] }
  ],
  /* 角色（可自定义增删改；builtin 为系统内置角色，不可删除；成员一人一角色） */
  roles: [
    { id: 'R-TOP', name: '最高管理员', desc: '平台唯一的管理员账号（admin），对平台整体进行调控', builtin: true, users: ['admin'],
      perms: ['view', 'edit', 'modify', 'disable', 'export', 'manage', 'audit', 'reviewCreate', 'task', 'exec', 'bug', 'page.stats', 'page.std', 'page.prod', 'page.tasks', 'page.archive', 'page.reviews', 'page.perm', 'delete', 'roleManage'] },
    { id: 'R-L1', name: '一级', desc: '测试部主管级及以上', builtin: true, users: [],
      perms: ['view', 'edit', 'modify', 'disable', 'export', 'manage', 'audit', 'reviewCreate', 'task', 'exec', 'bug', 'page.stats', 'page.std', 'page.prod', 'page.tasks', 'page.archive', 'page.reviews', 'page.perm', 'roleManage'] },
    { id: 'R-L2', name: '二级', desc: '测试部全员', builtin: true, users: [],
      perms: ['view', 'edit', 'modify', 'disable', 'export', 'audit', 'reviewCreate', 'task', 'exec', 'bug', 'page.stats', 'page.std', 'page.prod', 'page.tasks', 'page.archive', 'page.reviews', 'page.perm'] },
    { id: 'R-L3', name: '三级', desc: '产品、研发及其他相关人员', builtin: true, users: [],
      perms: ['audit', 'page.reviews', 'page.perm'] },
    { id: 'R-EX', name: '只读观察员', desc: '自定义角色示例：仅可查看用例库与数据统计，无修改 / 导出 / 审核权限', builtin: false, users: [],
      perms: ['view', 'page.stats', 'page.std', 'page.prod', 'page.reviews', 'page.perm'] }
  ],
  /* 权限变更记录（角色 / 权限项 / 成员变更留痕） */
  permAudits: [
    { time: '2026-10-09 09:24:18', operator: '最高管理员', target: '角色 · 二级', action: '权限 17 项；成员 11 → 11 人（调整「导出用例」等 3 项）' },
    { time: '2026-09-28 16:40:31', operator: '最高管理员', target: '角色 · 只读观察员', action: '新增角色（6 项权限，成员 0 人）' }
  ],
  /* 权限移交记录（所有审批权限的移交按平台流程执行） */
  handovers: [
    { id: 'YJ-2026-0002', type: '任务权限', object: '2026年常规任务测试（RW2026092100050）', from: '曹银凤', to: '魏勇', reason: '休假期间任务代管', date: '2026-10-08', status: '已生效' },
    { id: 'YJ-2026-0001', type: '模块维护责任人', object: '指示灯（FUNC-FW-002）', from: '刘增通', to: '魏勇', reason: '人员岗位调整', date: '2026-09-30', status: '已生效' }
  ],
  /* 企业微信提醒（审核期限 48/24/12 小时节点推送） */
  notices: [],

  /* ---------- 缺陷（执行过程中提交，字段与平台缺陷库一一对应） ---------- */
  bugs: [
    { id: 'BUG-2026-0042', caseId: 'FT2025111213468', model: 'USR-ISG1008', execId: 'ZXRW2025111200096', source: '日常测试工作',
      level: '一般C', priority: '重要不紧急', freq: '偶现', isNew: '是', title: 'CAN 口缓存不使能时短连接重连后仍收到断开期间数据',
      testProject: 'CAN', testType: '功能测试', dev: '李亚菲', tester: '寇然然', submitter: '寇然然', date: '2026-03-03',
      round: '第 1 轮', hwVersion: 'V1.1.00', fwVersion: 'V1.0.02', pre: 'EUT 连接 PC，数据可正常传输，EUT 设置为 TCPC 模式。',
      steps: '1.设置 socket 工作模式为 TCPC；2.设置 CAN 口缓存不使能并开启短连接；3.重启后断开网络服务端，CAN 口发送数据，再重新连接。',
      input: 'CAN 缓存：不使能', expect: '重新连接后不应收到断开期间的数据', actual: '重新连接后仍能收到 CAN 口断开时发送的数据，与规范「短连接下缓存默认开启」描述不一致',
      desc: '步骤与预期一致，但现象与预期不符，需研发确认短连接下 CAN 缓存的默认策略。', expectFix: '2026-03-20', status: '已提交' },
    { id: 'BUG-2026-0041', caseId: 'FT2025111213342', model: 'USR-ISG1008', execId: 'ZXRW2025111200096', source: '抽样试验',
      level: '微小D', priority: '紧急不重要', freq: '必现', isNew: '否', title: '主机名设置为特殊字符组合时内置页面显示异常',
      testProject: '系统', testType: '功能测试', dev: '李亚菲', tester: '寇然然', submitter: '寇然然', date: '2026-03-02',
      round: '第 1 轮', hwVersion: 'V1.1.00', fwVersion: 'V1.0.02', pre: 'EUT 运行正常', steps: '1.进入内置网页；2.修改主机名为输入数据；3.保存应用。',
      input: '特殊字符组合', expect: '设置成功且页面左上角显示与设置一致', actual: '主机名含多个连续下划线时页面左上角显示被截断',
      desc: '显示层截断，不影响功能，建议优化显示长度限制。', expectFix: '2026-03-25', status: '已解决' },
    { id: 'BUG-2026-0039', caseId: 'FT2025111212697', model: 'USR-G780 V2', execId: 'ZXRW2026092100158', source: '客户问题反馈',
      level: '严重B', priority: '紧急重要', freq: '必现', isNew: '是', title: 'NTP 备用服务器地址设置为 101B 字符时无错误提示',
      testProject: 'NTP', testType: '功能测试', dev: '刘增通', tester: '杨立佳', submitter: '杨立佳', date: '2026-03-01',
      round: '第 1 轮', hwVersion: 'V2.1.00', fwVersion: 'V1.0.05', pre: '开启 NTP', steps: '1.开启 NTP 功能；2.设置 NTP 服务器备地址为 101B 长度字符。',
      input: 'NTP 服务器备地址：101B 长度字符', expect: '有错误提示且不可设置成功', actual: '地址栏可输入 101B 字符并保存成功，实际同步异常',
      desc: '长度校验缺失，建议后端补充参数长度校验并给出明确错误提示。', expectFix: '2026-03-15', status: '处理中' }
  ],

  /* ---------- 市场问题（平台内市场问题闭环流程流转，质控指定反推用例） ---------- */
  marketBugs: [
    { id: 'SC-2026-0007', model: 'USR-ISG1008', module: '指示灯', title: '客户现场指示灯偶发不亮，重启后恢复',
      level: '严重B', freq: '偶现', submitter: '刘志松', date: '2026-09-26', status: '待反推用例',
      pre: '设备正常上电运行，指示灯模块工作正常。', steps: '1.设备连续运行 72 小时；2.观察指示灯状态；3.记录异常发生时间点。',
      expect: '指示灯常亮，无熄灭现象', actual: '运行约 40 小时后指示灯熄灭，重启设备后恢复',
      desc: '市场反馈 3 起同类问题，需在模块用例库中补充长稳验证用例。', closeStatus: '市场问题闭环处理中' },
    { id: 'SC-2026-0005', model: 'USR-G780 V2', module: '心跳包', title: '弱网环境下心跳断链后恢复时间超出规格',
      level: '一般C', freq: '经常', submitter: '刘志松', date: '2026-09-18', status: '已反推用例',
      pre: '设备与服务器心跳通道建立成功。', steps: '1.模拟弱网丢包 30%；2.断开网络 10 分钟；3.恢复网络观察心跳恢复时间。',
      expect: '心跳在 30s 内自动恢复发送', actual: '弱网恢复后心跳最长 95s 才恢复发送',
      desc: '需补充弱网恢复场景用例并评估规格是否需要修订。', closeStatus: '市场问题闭环已完成' }
  ],

  moduleReviews: [
    { id: 'MRV-2026-0018', type: '测试方案', target: '指示灯_测试方案_V1.2_20260928', module: '指示灯', submitter: '刘增通', submitDate: '2026-10-10', deadline: '2026-10-17', scope: '部门内（模块用例审核）', status: '审核中', participants: ['刘增通', '李英文', '曹银凤', '魏勇'], opinions: [['刘增通', '主分支/次分支划分与产品实测一致', '同意'], ['李英文', 'USR-G780 呼吸灯判定标准需补充波形描述', '同意'], ['曹银凤', '建议补充上电时序用例', '同意']] },
    { id: 'MRV-2026-0019', type: '测试用例', target: '指示灯 · 主分支（共性）（模块用例 8 条）', module: '指示灯', submitter: '刘增通', submitDate: '2026-10-11', deadline: '2026-10-12', scope: '部门内（模块用例审核）', status: '待审核', participants: [], opinions: [] },
    { id: 'MRV-2026-0011', type: '测试用例', target: '心跳包 · 主分支（共性）（模块用例 6 条）', module: '心跳包', submitter: '李英文', submitDate: '2026-04-18', deadline: '2026-04-20', scope: '部门内（模块用例审核）', status: '已通过', participants: ['李英文', '刘增通', '魏勇', '秦文都'], opinions: [['李英文', '同意', '同意'], ['刘增通', '同意', '同意'], ['魏勇', '同意', '同意']], result: '同意 4 / 反对 0，模块用例审核通过' }
  ],

  productReviews: [
    { id: 'PRV-2026-0044', type: '产品测试用例', target: 'USR-ISG1008_产品测试用例_V1.3_20261008', product: 'USR-ISG1008', submitter: '曹银凤', submitDate: '2026-10-08', deadline: '2026-10-13', scope: '项目内（产品用例审核）', status: '已通过', participants: ['曹银凤', '李英文', '刘志松', '秦文都', '魏勇'], opinions: [['刘志松', '引用功能级版本正确，专属增补合理', '同意'], ['李英文', '同意', '同意'], ['秦文都', '同意', '同意']], result: '同意 5 / 反对 0，产品用例审核通过' },
    { id: 'PRV-2026-0045', type: '产品测试用例', target: 'USR-G780V2_产品测试用例_V2.1_20260930', product: 'USR-G780 V2', submitter: '刘增通', submitDate: '2026-09-30', deadline: '2026-10-14', scope: '项目内（产品用例审核）', status: '审核中', participants: ['刘增通', '刘伟', '马方方', '魏勇'], opinions: [['马方方', '指示灯次分支引用版本落后于模块库，需先更新再审核', '反对'], ['刘伟', '同意在版本升级后通过', '同意']] },
    { id: 'PRV-2026-0046', type: '产品测试方案', target: 'USR-ISG1008_产品测试方案_V1.3_20261008', product: 'USR-ISG1008', submitter: '曹银凤', submitDate: '2026-10-07', deadline: '2026-10-12', scope: '项目内（产品用例审核）', status: '审核中', participants: ['曹银凤', '李英文', '刘志松'], opinions: [] }
  ]
};

/* 模块用例库补充：心跳包 / 硬件看门狗 / 指示灯（USR-G780）/ 心跳包（产品2）分支标准用例 */
mock.stdCases = mock.stdCases.concat([
  { id: 'UT2026041626301', level: 'L2', module: '心跳包', branch: '产品通用', functionPoint: '心跳周期', testPoint: '通信可靠性', summary: '心跳间隔配置为 5s 时按 5s 周期发送', designer: '李英文', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2', 'USR-N580'] },
  { id: 'UT2026041626302', level: 'L2', module: '心跳包', branch: '产品通用', functionPoint: '心跳周期', testPoint: '边界值', summary: '心跳间隔在 1s～3600s 范围内可配置且生效', designer: '李英文', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2', 'USR-N580'] },
  { id: 'UT2026041626303', level: 'L3', module: '心跳包', branch: '产品通用', functionPoint: '心跳内容', testPoint: '通信可靠性', summary: '心跳包内容包含设备 ID 与状态字段', designer: '李英文', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2', 'USR-N580'] },
  { id: 'UT2026041626304', level: 'L2', module: '心跳包', branch: '产品通用', functionPoint: '异常断链', testPoint: '异常场景', summary: '网络断开后心跳发送暂停且不产生异常日志', designer: '李英文', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2', 'USR-N580'] },
  { id: 'UT2026041626305', level: 'L2', module: '心跳包', branch: '产品通用', functionPoint: '异常断链', testPoint: '恢复验证', summary: '网络恢复后心跳自动恢复发送', designer: '李英文', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2', 'USR-N580'] },
  { id: 'UT2026041626306', level: 'L3', module: '心跳包', branch: '产品通用', functionPoint: '重试策略', testPoint: '异常场景', summary: '心跳发送失败按重试策略重发', designer: '李英文', status: '正常', refProducts: ['USR-ISG1008', 'USR-G780 V2', 'USR-N580'] },
  { id: 'UT2026041626311', level: 'L3', module: '心跳包', branch: '指定产品', functionPoint: '发送方向', testPoint: '功能验证', summary: '单向心跳：仅设备向平台方向发送', designer: '李英文', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026041626312', level: 'L3', module: '心跳包', branch: '指定产品', functionPoint: '触发逻辑', testPoint: '功能验证', summary: '连接保活触发心跳（无应用数据时按保活周期发送）', designer: '李英文', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026041626313', level: 'L2', module: '心跳包', branch: '指定产品', functionPoint: '异常断链', testPoint: '异常场景', summary: '异常断开后 3 次重试仍失败则重建连接', designer: '李英文', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026041626314', level: 'L3', module: '心跳包', branch: '指定产品', functionPoint: '参数校验', testPoint: '边界值', summary: '心跳参数非法时回退默认值', designer: '李英文', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026041626315', level: 'L3', module: '心跳包', branch: '指定产品', functionPoint: '心跳周期', testPoint: '边界值', summary: '心跳发送间隔最小 2s 限制验证', designer: '李英文', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026031126401', level: 'L2', module: '硬件看门狗', branch: '产品通用', functionPoint: '喂狗时序', testPoint: '功能验证', summary: '正常喂狗时设备不复位', designer: '曹银凤', status: '正常', refProducts: ['USR-ISG1008'] },
  { id: 'UT2026031126402', level: 'L1', module: '硬件看门狗', branch: '产品通用', functionPoint: '超时复位', testPoint: '异常场景', summary: '停止喂狗 2s 后设备自动复位', designer: '曹银凤', status: '正常', refProducts: ['USR-ISG1008'] },
  { id: 'UT2026031126403', level: 'L2', module: '硬件看门狗', branch: '产品通用', functionPoint: '上电复位', testPoint: '功能验证', summary: '上电复位后设备正常启动', designer: '曹银凤', status: '正常', refProducts: ['USR-ISG1008'] },
  { id: 'UT2026031126404', level: 'L3', module: '硬件看门狗', branch: '产品通用', functionPoint: '状态恢复', testPoint: '恢复验证', summary: '异常复位后业务状态正确恢复', designer: '曹银凤', status: '正常', refProducts: ['USR-ISG1008'] },
  { id: 'UT2026061026501', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '电源状态指示灯（POW）', testPoint: '人机交互', summary: 'POW 指示灯绿色常亮', designer: '刘增通', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026061026502', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '运行指示灯（RUN）', testPoint: '人机交互', summary: 'RUN 呼吸灯效果与周期验证', designer: '刘增通', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026061026503', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '网络指示灯（NET）', testPoint: '人机交互', summary: 'NET 慢闪表示未联网', designer: '刘增通', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026061026504', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '网络指示灯（NET）', testPoint: '人机交互', summary: 'NET 常亮表示已联网', designer: '刘增通', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026061026505', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '串口指示灯', testPoint: '人机交互', summary: '串口收发数据时指示灯闪烁', designer: '刘增通', status: '正常', refProducts: ['USR-G780 V2'] },
  { id: 'UT2026061026506', level: 'L3', module: '指示灯', branch: '指定产品', functionPoint: '外观规格', testPoint: '人机交互', summary: '指示灯亮度与颜色符合规格要求', designer: '刘增通', status: '正常', refProducts: ['USR-G780 V2'] }
]);

/* ===== 历史样例任务：RW2025111200018 双路CANFD光纤网关 ===== */
mock.canfd = {
  task: {
    id: 'RW2025111200018', type: '项目任务', name: '双路CANFD光纤网关',
    pm: '杨战东', productManager: '李雨佳', contact: '李英文', testLead: '',
    finished: '否', caseSource: '产品用例库 · USR-CAN528'
  },
  execTasks: [
    {
      execId: 'ZXRW2025123000101', taskId: 'RW2025111200018', name: 'USR-CAN528固件四轮',
      model: 'USR-CAN528', domain: '固件', round: 4, hwVersion: 'V2.1', fwVersion: 'V1.0.07.000000.0000',
      rdOwner: '张宁', testOwner: '寇然然', executors: '寇然然',
      planTime: 8, actualTime: 8, diverged: 0, productName: '双路CANFD光纤网关',
      totals: { planned: 94, actual: 94, passed: 81, failed: 5, blocked: 0, notRun: 8 },
      execStats: [
        { name: '寇然然', planned: 94, actual: 94, passed: 81, failed: 5, blocked: 0, notRun: 8, diverged: 0 },
        { name: '', planned: 0 }, { name: '', planned: 0 }, { name: '', planned: 0 }, { name: '', planned: 0 }
      ]
    },
    {
      execId: 'ZXRW2025111200096', taskId: 'RW2025111200018', name: 'USR-CAN528固件三轮',
      model: 'USR-CAN528', domain: '固件', round: 3, hwVersion: 'V1.1', fwVersion: 'V1.0.04.000000.0000',
      rdOwner: '张宁', testOwner: '李亚菲', executors: '李亚菲 杨立佳 寇然然',
      planTime: 96, actualTime: 92, diverged: 0, productName: '双路CANFD光纤网关',
      totals: { planned: 1138, actual: 1138, passed: 976, failed: 53, blocked: 96, notRun: 13 },
      execStats: [
        { name: '李亚菲', planned: 500, actual: 500, passed: 430, failed: 22, blocked: 42, notRun: 6, diverged: 0 },
        { name: '杨立佳', planned: 400, actual: 400, passed: 347, failed: 18, blocked: 32, notRun: 3, diverged: 0 },
        { name: '寇然然', planned: 238, actual: 238, passed: 199, failed: 13, blocked: 22, notRun: 4, diverged: 0 },
        { name: '', planned: 0 }, { name: '', planned: 0 }
      ]
    },
    {
      execId: 'ZXRW2025111200091', taskId: 'RW2025111200018', name: 'USR-CAN528硬件一轮',
      model: 'USR-CAN528', domain: '硬件', round: 1, hwVersion: 'PCB:V1.1 BOM:V1.1.10', fwVersion: 'V1.0.02.000000.0000',
      rdOwner: '宋立雷', testOwner: '秦文都', executors: '秦文都',
      planTime: 12, actualTime: 12, diverged: 0, productName: '双路CANFD光纤网关',
      totals: { planned: 100, actual: 100, passed: 91, failed: 8, blocked: 0, notRun: 1 },
      execStats: [
        { name: '秦文都', planned: 100, actual: 100, passed: 91, failed: 8, blocked: 0, notRun: 1, diverged: 0 },
        { name: '', planned: 0 }, { name: '', planned: 0 }, { name: '', planned: 0 }, { name: '', planned: 0 }
      ]
    }
  ],
  /* 用例执行明细（样例，真实字段结构；实际共 94/1138/100 条） */
  cases: [
    { seq: 1, caseId: 'FT2025111213273', result: 'Fail', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L3', source: '测试任务', testType: '功能测试', testProject: 'NTP', functionPoint: 'ntp服务器校准机制', testPoint: '功能逻辑', summary: '校准机制', pre: '开启NTP EUT联网正常', steps: '1.开启NTP功能； 2.设置NTP服务器主备地址； 3.重启设备使参数生效； 4.待NTP校准成功后设置EUT系统时间 5.查看EUT系统时间', input: '无', expect: '校时方式独立，EUT系统时间为设置时间', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 2, caseId: 'FT2025111213254', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L3', source: '测试任务', testType: '功能测试', testProject: '固件升级', functionPoint: '固件升级', testPoint: '应用场景', summary: '升级过程中LAN断网', pre: 'EUT出厂设置，LAN口连接PC', steps: '1. 进入内置页面升级页面 2.点击浏览，进入PC文件夹，选择正常固件，点击刷写，进入升级页面 3.点击执行 4.LAN网线断开', input: '无', expect: '固件升级成功，为升级后固件版本', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 3, caseId: 'FT2025111213459', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L3', source: '测试任务', testType: '功能测试', testProject: 'CAN', functionPoint: 'CAN缓存', testPoint: '功能逻辑', summary: 'CAN口缓存使能_功能逻辑_socket模式TCPS', pre: 'EUT连接PC,数据可正常传输', steps: '1.进入设置软件或内置网页； 2.设备socket工作模式设置为TCPS； 3.设置CAN口缓存使能； 4.设置完成后重启； 5.不建立网络连接，CAN口端发送任意数据； 6.客户端与设备建立TCP连接，查看设备状态', input: 'CAN口缓存：使能 socket模式：TCPS', expect: '网络端收到缓存数据，数据准确', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 4, caseId: 'FT2025111213357', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L1', source: '测试任务', testType: '功能测试', testProject: '协议转换', functionPoint: '透明转换', testPoint: '功能逻辑', summary: '透明转换-允许转发CAN帧ID、允许转发CAN帧信息组合有效性-=0字节', pre: 'EUT串口端<->CAN端数据可正常传输 协议方式：CANFD，使能CANFD加速', steps: '1.EUT上电运行正常； 2.设置帧类型帧ID 3.设置转换模式：透明转换 4.允许转发CAN帧ID使能：开启 5.允许转发CAN帧信息使能：开启 6.设置完成后重启； 7.EUT CAN与CAN助手建立通讯； 8.EUT 串口与串口助手建立通讯； 9.串口和CAN助手双向互发数据。', input: '数据：等于0字节有效数据', expect: '收到数据正确，只有帧信息、有帧ID，协议正确', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 5, caseId: 'FT2025111213171', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L2', source: '测试任务', testType: '功能测试', testProject: '协议转换', functionPoint: '自定义帧头帧尾', testPoint: '功能逻辑', summary: '自定义帧头帧尾_CAN到串口发送数据验证-数据域长度=0字节', pre: 'EUT设置串口-CAN通道开启 协议方式：CANFD，使能CANFD加速', steps: '1.EUT设置串口-CAN通道开启； 2.设置帧类型、帧ID 2.设置转换模式：自定义帧头帧尾，其他参数默认值不变 3.设置完成后重启； 4.EUT CAN与CAN助手建立通讯； 5.EUT 串口与串口助手建立通讯； 6.CAN助手发送数据。', input: '数据：正常的标准帧CAN报文 数据域长度=00', expect: '串口收到正常转换后的数据（帧头+数据域长度+数据域+帧尾） 只有帧头数据域长度帧尾 无数据', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 6, caseId: 'FT2025111213221', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L1', source: '测试任务', testType: '功能测试', testProject: '协议转换', functionPoint: '透明带id转换', testPoint: '功能逻辑', summary: '透明带ID转换默认参数下主干功能逻辑验证-CAN口发送数据长度为0的数据', pre: 'EUT设置串口-CAN通道开启 协议方式：CAN FD，使能CAN加速', steps: '1.EUT设置串口-CAN通道开启； 2.设置CAN ID 3.设置转换模式：透明带ID转换，其他参数默认值不变 4.设置完成后重启； 5.EUT CAN与CAN助手建立通讯； 6.EUT 串口与串口助手建立通讯； 7.CAN助手发送数据。', input: '数据：数据长度为0的数据', expect: '串口收到转换后的数据（帧ID） 帧ID所在串口数据的位置及长度无误', remark: '默认起始地址长度下验证', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 7, caseId: 'FT2025111213397', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L1', source: '测试任务', testType: '功能测试', testProject: '协议转换', functionPoint: '透明转换', testPoint: '功能逻辑', summary: '透明转换-允许转发CAN帧ID、允许转发CAN帧信息组合有效性-=0字节（CAN协议）', pre: 'EUT串口端<->CAN端数据可正常传输 协议方式：CAN', steps: '1.EUT上电运行正常； 2.设置帧类型帧ID 3.设置转换模式：透明转换 4.允许转发CAN帧ID使能：开启 5.允许转发CAN帧信息使能：开启 6.设置完成后重启； 7.EUT CAN与CAN助手建立通讯； 8.EUT 串口与串口助手建立通讯； 9.串口和CAN助手双向互发数据。', input: '数据：等于0字节有效数据', expect: '收到数据正确，只有帧信息、有帧ID，协议正确', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 8, caseId: 'FT2025111213339', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L2', source: '测试任务', testType: '功能测试', testProject: '系统', functionPoint: '系统-管理权用户名', testPoint: '参数设置', summary: '用户名-有效值（最小字符长度）', pre: '打开EUT内置网页正常；', steps: '1.打开EUT内置网页； 2.设置系统管理权用户名为输入数据； 5.点击保存，查看现象；', input: '最小字符长度有效值组合', expect: '设置成功', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 9, caseId: 'FT2025111212662', result: 'Pass', date: '2026-01-07', resultNote: '', auto: '否', actualTime: 5, planDate: '2026-01-07', domain: '固件', level: 'L3', source: '测试任务', testType: '功能测试', testProject: 'MODBUS', functionPoint: 'modbus网关-发送报文', testPoint: '参数设置', summary: '触发帧ID、触发帧类型参数无效性验证', pre: 'CAN（FD）转modbus网关使能', steps: '1.设置EUTCAN（FD）转modbus网关：开启 2.设置发送报文触发帧ID，触发帧类型为输入数据； 3.发送报文其他参数均为有效参数', input: 'AT+ADDSDLIST 触发帧类型：标准帧,触发帧ID：800', expect: '设置失败，设备无异常', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 10, caseId: 'FT2025111213342', result: 'Pass', date: '2025-12-30', resultNote: '支持', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L2', source: '测试任务', testType: '功能测试', testProject: '系统', functionPoint: '系统-主机名', testPoint: '参数设置', summary: '主机名参数设置-有效设置', pre: 'EUT运行正常', steps: '1.进入EUT内置网页，进行设置； 2.在左侧目录中打开系统-基本设置； 3.更改主机名为输入数据； 4.保存应用； 5.查看内置页面左上角显示是否与设置参数的一样', input: '不以 - . 开头和结尾的有效参数组合', expect: '设置成功，内置页面左上角显示与设置的参数一致', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 11, caseId: 'FT2025111212624', result: 'Pass', date: '2026-01-07', resultNote: '', auto: '否', actualTime: 5, planDate: '2026-01-07', domain: '固件', level: 'L3', source: '测试任务', testType: '功能测试', testProject: 'MODBUS', functionPoint: 'modbus网关-发送报文', testPoint: '功能逻辑', summary: '发送报文-远程帧约束性验证（远程帧：否）', pre: 'CAN（FD）转modbus网关使能', steps: '1.设置EUTCAN（FD）转modbus网关：开启 2.设置工作模式：RTU主站 3.设置发送报文-远程帧输入数据； 4.设置发送报文其他参数，发送数据(映射变量)均为有效参数 5.设备串口与PC端Slave从机建立连接 6.设备CAN口与CAN分析仪建立连接 7.监测 EUT CAN口发送数据', input: 'CANFD协议 发送报文-是否远程帧：否', expect: 'EUT CAN口发送帧数据为数据帧', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 12, caseId: 'FT2025111212625', result: 'Pass', date: '2026-01-07', resultNote: '', auto: '否', actualTime: 5, planDate: '2026-01-07', domain: '固件', level: 'L2', source: '测试任务', testType: '功能测试', testProject: 'MODBUS', functionPoint: 'modbus网关-发送报文', testPoint: '功能逻辑', summary: '发送报文-远程帧约束性验证（远程帧：是）', pre: 'CAN（FD）转modbus网关使能', steps: '1.设置EUTCAN（FD）转modbus网关：开启 2.设置工作模式：RTU主站 3.设置发送报文-远程帧输入数据； 4.设置发送报文其他参数，发送数据(映射变量)均为有效参数 5.设备串口与PC端Slave从机建立连接 6.设备CAN口与CAN分析仪建立连接 7.监测 EUT CAN口发送数据', input: 'CANFD协议 发送报文-是否远程帧：是', expect: 'EUT CAN口发送帧数据为数据帧', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 13, caseId: 'FT2025111213343', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L2', source: '测试任务', testType: '功能测试', testProject: '系统', functionPoint: '系统-主机名', testPoint: '参数设置', summary: '主机名参数设置-有效设置（大小写字母数字混合）', pre: 'EUT运行正常', steps: '1.进入EUT内置网页，进行设置； 2.在左侧目录中打开系统-基本设置； 3.更改主机名为输入数据； 4.保存应用； 5.查看内置页面左上角显示是否与设置参数的一样', input: '数据类型： 长度范围内大小写字母数字混合', expect: '设置成功，内置页面左上角显示与设置的参数一致', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 14, caseId: 'FT2025111213410', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L3', source: '测试任务', testType: '功能测试', testProject: '协议转换', functionPoint: '透明转换', testPoint: '功能逻辑', summary: '透明转换-允许转发CAN扩展帧帧信息有效性验证-开启-CAN口发送数据长度=0字节验证', pre: 'EUT串口端<->CAN端数据可正常传输 协议方式：CAN', steps: '1.设置转换模式：透明转换 2.允许转发CAN信息使能：开启 3.设置完成后重启； 4.EUT CAN与CAN助手建立通讯； 5.EUT 串口与串口助手建立通讯； 6.CAN助手发送数据。', input: '数据：长度为0的扩展帧数据', expect: '串口收到转换后的数据（数据），只有帧信息，帧信息正确', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 15, caseId: 'FT2025111213222', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L1', source: '测试任务', testType: '功能测试', testProject: '协议转换', functionPoint: '透明带id转换', testPoint: '功能逻辑', summary: '透明带ID转换默认参数下主干功能逻辑验证-串口发送数据长度只有帧ID', pre: 'EUT设置串口-CAN通道开启 协议方式：CAN FD，使能CAN加速', steps: '1.EUT设置串口-CAN通道开启； 2.设置CAN ID 3.设置转换模式：透明带ID转换，其他参数默认值不变 4.设置完成后重启； 5.EUT CAN与CAN助手建立通讯； 6.EUT 串口与串口助手建立通讯； 7.串口助手发送数据。', input: '数据：只含有帧ID', expect: 'CAN口收到转换后的数据（帧信息+帧ID+空内容数据域） 帧ID：串口数据中发送的帧ID', remark: '默认起始地址长度下验证', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' },
    { seq: 16, caseId: 'FT2025111213468', result: 'Pass', date: '2025-12-30', resultNote: '', auto: '否', actualTime: 5, planDate: '2025-12-30', domain: '固件', level: 'L2', source: '测试任务', testType: '功能测试', testProject: 'CAN', functionPoint: 'CAN缓存', testPoint: '功能逻辑', summary: 'CAN口缓存不使能_TCPC短连接', pre: 'EUT连接PC,数据可正常传输，EUT设置为TCPC模式。', steps: '1.进入设置软件或内置网页； 2.设备socket工作模式设置为TCPC； 3.设置CAN口缓存不使能，开启短连接功能； 4.设置完成后重启； 5.断开网络服务端，CAN口发送不同数据，然后重新连接网络服务端', input: 'CAN缓存：不使能 CAN口端：发送数据', expect: '重新连接后，能接收到CAN口断开时发送的数据 （短连接下缓存默认为开启）', remark: '无', manualMin: 5, autoFlag: '否', designer: '寇然然', executor: '寇然然' }
  ],
  /* 执行页样例（用例执行-全部执行人）：执行结果 / 备注 / 是否自动化 / 实际测试时间 行内可编辑 */
  execRows: [
    { seq: 1, caseId: 'FT2025111212697', result: 'N/A', resultNote: '129B', auto: '否', actualTime: 5, testProject: 'NTP', functionPoint: 'ntp备用服务器地址参数设置', summary: 'NTP服务器备地址参数长度限制情况', pre: '开启NTP', steps: '1.开启NTP功能； 2.设置NTP服务器备地址。', input: 'NTP服务器备地址：设置为101B长度字符', expect: '有错误提示，且不可设置成功', executor: '寇然然' },
    { seq: 2, caseId: 'FT2025111212696', result: 'N/A', resultNote: '128B', auto: '否', actualTime: 5, testProject: 'NTP', functionPoint: 'ntp备用服务器地址参数设置', summary: 'NTP服务器备地址参数长度限制情况', pre: '开启NTP', steps: '1.开启NTP功能； 2.设置NTP服务器备地址； 3.重启设备使参数生效。', input: 'NTP服务器备地址：设置为100B长度字符', expect: '设置成功', executor: '寇然然' },
    { seq: 3, caseId: 'FT2025111212695', result: 'N/A', resultNote: '127B', auto: '否', actualTime: 5, testProject: 'NTP', functionPoint: 'ntp备用服务器地址参数设置', summary: 'NTP服务器备地址参数有效性验证', pre: '开启NTP', steps: '1.开启NTP功能； 2.设置NTP服务器备地址为输入数据； 3.查看NTP同步状态。', input: 'NTP服务器备地址：有效IP地址', expect: 'NTP同步成功', executor: '寇然然' },
    { seq: 4, caseId: 'FT2025111212698', result: 'Fail', resultNote: '与预期不符，已提交Bug', auto: '否', actualTime: 8, testProject: 'NTP', functionPoint: 'ntp服务器校准机制', summary: 'NTP服务器主地址参数校准', pre: '开启NTP EUT联网正常', steps: '1.开启NTP功能； 2.设置NTP服务器主地址； 3.重启设备； 4.查看EUT系统时间。', input: 'NTP服务器主地址：公共NTP地址', expect: 'EUT系统时间与NTP服务器一致', executor: '寇然然' },
    { seq: 5, caseId: 'FT2025111212661', result: 'Pass', resultNote: '', auto: '否', actualTime: 5, testProject: 'NTP', functionPoint: 'ntp服务器校准机制', summary: '校准机制-手动触发校时', pre: '开启NTP EUT联网正常', steps: '1.开启NTP功能； 2.手动触发校时； 3.查看EUT系统时间。', input: '无', expect: 'EUT系统时间被刷新', executor: '寇然然' },
    { seq: 6, caseId: 'FT2025111212660', result: 'Pass', resultNote: '', auto: '否', actualTime: 5, testProject: 'NTP', functionPoint: 'ntp服务器校准机制', summary: '校准机制-断网后校时', pre: '开启NTP EUT联网正常', steps: '1.开启NTP功能； 2.断开网络； 3.恢复网络； 4.查看EUT系统时间。', input: '无', expect: '网络恢复后自动校准', executor: '寇然然' },
    { seq: 7, caseId: 'FT2025111212659', result: 'Pass', resultNote: '', auto: '否', actualTime: 5, testProject: 'NTP', functionPoint: 'ntp服务器校准机制', summary: '校准机制-服务器不可用时行为', pre: '开启NTP EUT联网正常', steps: '1.开启NTP功能； 2.设置不可用的NTP服务器地址； 3.观察设备日志。', input: 'NTP服务器地址：不可用地址', expect: '设备正常，记录失败日志', executor: '寇然然' },
    { seq: 8, caseId: 'FT2025111212658', result: 'N/A', resultNote: '', auto: '否', actualTime: 5, testProject: 'NTP', functionPoint: 'ntp服务器校准机制', summary: '校准机制-时区设置联动', pre: '开启NTP EUT联网正常', steps: '1.开启NTP功能； 2.设置时区； 3.查看EUT系统时间。', input: '时区：UTC+8', expect: '系统时间随时区变化', executor: '寇然然' }
  ],
  logs: [
    { taskId: 'RW2025111200018', execId: 'ZXRW2025111200096', time: '2026-03-03 15:13:00', operator: '李亚菲', action: '成功执行用例:FT2025111212698,共1条用例！' },
    { taskId: 'RW2025111200018', execId: 'ZXRW2025111200096', time: '2026-03-03 15:12:59', operator: '李亚菲', action: '成功执行用例:FT2025111212698,共1条用例！' },
    { taskId: 'RW2025111200018', execId: 'ZXRW2025111200096', time: '2026-03-03 15:12:57', operator: '李亚菲', action: '成功执行用例:FT2025111212661,共1条用例！' },
    { taskId: 'RW2025111200018', execId: 'ZXRW2025111200096', time: '2026-03-03 15:12:53', operator: '李亚菲', action: '成功执行用例:FT2025111212696,共1条用例！' },
    { taskId: 'RW2025111200018', execId: 'ZXRW2025111200096', time: '2026-03-03 15:11:32', operator: '李亚菲', action: '成功执行用例:FT2025111212428,共1条用例！' },
    { taskId: 'RW2025111200018', execId: 'ZXRW2025123000101', time: '2026-01-07 09:49:49', operator: '寇然然', action: '成功执行用例:FT2025111212662,共1条用例！' },
    { taskId: 'RW2025111200018', execId: 'ZXRW2025123000101', time: '2026-01-07 09:49:35', operator: '寇然然', action: '成功添加1条用例！' },
    { taskId: 'RW2025111200018', execId: 'ZXRW2025123000101', time: '2026-01-07 09:46:01', operator: '寇然然', action: '成功执行用例:FT2025111212624,FT2025111212625,共2条用例！' },
    { taskId: 'RW2025111200018', execId: 'ZXRW2025123000101', time: '2026-01-07 09:45:59', operator: '寇然然', action: '成功执行用例:FT2025111212624,共1条用例！' }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = mock;

/* ================= 交付基线：清除全部演示 / 测试数据 =================
   保留「基础数据」：顶部导航、权限项、角色与成员、部门成员（登录与权限校验的基础）；
   业务数据（功能模块、用例、产品、任务与执行、审核、回流、缺陷、导出申请、日志等）一律清空，
   平台以空白状态启动，所有业务数据由使用者在平台上录入，并由 server 持久化到 data/db.json。 */
(function () {
  var business = ['stdModules', 'stdCases', 'stdStats', 'products', 'lineageProdToStd', 'tasks', 'executedTasks',
    'taskLogs', 'bugs', 'marketBugs', 'moduleReviews', 'productReviews', 'permAudits', 'handovers', 'notices',
    'logs', 'cases', 'execRows', 'exportRequests', 'draftCases'];
  business.forEach(function (k) { mock[k] = []; });
  ['stdCaseDetail', 'taskDetail', 'task'].forEach(function (k) { if (k in mock) mock[k] = {}; });
  mock.productMembers = {};
  delete mock.canfd;
})();
