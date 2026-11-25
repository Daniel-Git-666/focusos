const DOMAINS = {
  study:    { label: '学业 / 课程与考试', short: '学业', color: '#0071E3', cls: 'domain-study' },
  research: { label: '科研 / 毕业论文',   short: '论文', color: '#AF52DE', cls: 'domain-research' },
  kaogong:  { label: '28 考公筹备',       short: '28考公', color: '#5856D6', cls: 'domain-kaogong' },
  fitness:  { label: '减脂与运动习惯',     short: '减脂运动', color: '#30B955', cls: 'domain-fitness' },
  reading:  { label: '阅读与兴趣',        short: '阅读', color: '#FF9500', cls: 'domain-reading' }
};

const STATUSES = {
  todo:        { label: '待开始', color: '#8E8E93' },
  in_progress: { label: '进行中', color: '#0071E3' },
  review:      { label: '待确认 / 导师反馈', color: '#FF9500' },
  done:        { label: '已完成', color: '#30B955' }
};

const LUNAR_MONTH_MAP = {
  '正月': 1, '一月': 1, '1': 1, '二月': 2, '2': 2, '三月': 3, '3': 3,
  '四月': 4, '4': 4, '五月': 5, '5': 5, '六月': 6, '6': 6,
  '七月': 7, '7': 7, '八月': 8, '8': 8, '九月': 9, '9': 9,
  '十月': 10, '10': 10, '冬月': 11, '十一月': 11, '11': 11, '腊月': 12, '十二月': 12, '12': 12
};

const LUNAR_MONTH_NAMES = ['', '正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];
const LUNAR_DAY_NAMES = [
  '', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
];

function uid() {
  return (crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function diffDaysFromToday(dateStr) {
  if (!dateStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d) - now) / 86400000);
}

function formatTimeHMS(date = new Date()) {
  return date.toTimeString().slice(0, 8);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Native browser Chinese Lunar calendar resolver (no external library needed)
let lunarFmt = null;
try {
  lunarFmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' });
} catch {}

function getLunarMonthDay(dateObj) {
  if (!lunarFmt) return null;
  try {
    const parts = lunarFmt.formatToParts(dateObj);
    const mRaw = (parts.find(p => p.type === 'month')?.value || '').replace('闰', '');
    const dRaw = parseInt(parts.find(p => p.type === 'day')?.value || '0', 10);
    const mNum = LUNAR_MONTH_MAP[mRaw] || parseInt(mRaw, 10);
    if (!mNum || !dRaw) return null;
    return { month: mNum, day: dRaw };
  } catch {
    return null;
  }
}

function resolveNextAnniversaryDate(item) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (item.calendar === 'lunar') {
    const targetM = Number(item.lunarMonth);
    const targetD = Number(item.lunarDay);
    for (let i = 0; i <= 385; i++) {
      const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      const ld = getLunarMonthDay(probe);
      if (ld && ld.month === targetM && ld.day === targetD) {
        const iso = `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, '0')}-${String(probe.getDate()).padStart(2, '0')}`;
        return { nextSolar: iso, diffDays: i, displayLabel: `农历${LUNAR_MONTH_NAMES[targetM] || (targetM + '月')}${LUNAR_DAY_NAMES[targetD] || targetD}` };
      }
    }
    return { nextSolar: '', diffDays: null, displayLabel: `农历${targetM}月${targetD}日` };
  }

  // Solar recurring (MM-DD) or fixed YYYY-MM-DD
  if (item.recurring && item.solarDate && item.solarDate.length >= 10) {
    const [, mm, dd] = item.solarDate.split('-').map(Number);
    let candidate = new Date(now.getFullYear(), mm - 1, dd);
    if (candidate < now) candidate = new Date(now.getFullYear() + 1, mm - 1, dd);
    const iso = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}-${String(candidate.getDate()).padStart(2, '0')}`;
    return { nextSolar: iso, diffDays: Math.round((candidate - now) / 86400000), displayLabel: `公历 ${mm}月${dd}日` };
  }

  const diff = diffDaysFromToday(item.solarDate);
  return { nextSolar: item.solarDate || '', diffDays: diff, displayLabel: item.solarDate || '' };
}

const StorageService = {
  DB_NAME: 'LifeStudyHubDB',
  STORE_NAME: 'app_state',
  LS_KEY: 'lsh_state_backup_v2',
  IDB_KEY: 'main_v2',
  db: null,

  async init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) { resolve(null); return; }
      try {
        const req = indexedDB.open(this.DB_NAME, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            db.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
          }
        };
        req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  },

  async load() {
    await this.init();
    let idbData = null;
    if (this.db) {
      idbData = await new Promise((resolve) => {
        try {
          const tx = this.db.transaction(this.STORE_NAME, 'readonly');
          const req = tx.objectStore(this.STORE_NAME).get(this.IDB_KEY);
          req.onsuccess = () => resolve(req.result ? req.result.value : null);
          req.onerror = () => resolve(null);
        } catch { resolve(null); }
      });
    }
    let lsData = null;
    try {
      const raw = localStorage.getItem(this.LS_KEY);
      if (raw) lsData = JSON.parse(raw);
    } catch {}

    if (idbData && lsData) {
      return (new Date(lsData.meta?.updatedAt || 0) > new Date(idbData.meta?.updatedAt || 0)) ? lsData : idbData;
    }
    return idbData || lsData || null;
  },

  save(state, preserveTimestamp = false) {
    state.meta = state.meta || {};
    if (!preserveTimestamp) {
      state.meta.updatedAt = new Date().toISOString();
      delete state.meta.isSeed;
    }
    state.meta.schemaVersion = 2;
    this.updateSaveIndicator('saving');

    try { localStorage.setItem(this.LS_KEY, JSON.stringify(state)); } catch {}

    if (this.db) {
      try {
        const tx = this.db.transaction(this.STORE_NAME, 'readwrite');
        tx.objectStore(this.STORE_NAME).put({ key: this.IDB_KEY, value: state });
        tx.oncomplete = () => this.updateSaveIndicator('saved');
        tx.onerror = () => this.updateSaveIndicator('saved');
      } catch { this.updateSaveIndicator('saved'); }
    } else {
      this.updateSaveIndicator('saved');
    }
  },

  updateSaveIndicator(mode) {
    const dot = document.getElementById('saveStatusDot');
    const txt = document.getElementById('saveStatusText');
    const sub = document.getElementById('saveStatusSub');
    if (!dot) return;
    if (mode === 'saving') {
      dot.classList.add('saving');
      txt.textContent = '正在持久化保存...';
    } else {
      dot.classList.remove('saving');
      txt.textContent = `本地已实时保存 · ${formatTimeHMS()}`;
      sub.textContent = 'IndexedDB 双层防丢 · 点击设置';
    }
  }
};

function createPersonalInitialState() {
  const now = new Date().toISOString();
  return {
    meta: { updatedAt: '2020-01-01T00:00:00.000Z', schemaVersion: 2, isSeed: true },
    sprints: [
      { id: 'sp-eviews', title: '统计学 EViews 6.0 上机考', date: '2026-12-04', domain: 'study', note: '重点：课件梳理 + EViews 6.0 实操' },
      { id: 'sp-fin', title: '金融资产评估论文提交', date: '2026-12-07', domain: 'study', note: '定稿排版 + 估值模型核对' },
      { id: 'sp-cet6', title: '英语六级 (CET-6) 冲刺', date: '2026-12-12', domain: 'study', note: '上次只差十几分，猛攻真题听力阅读' },
      { id: 'sp-thesis', title: '硕士毕业论文开题答辩', date: '2026-12-20', domain: 'research', note: '高频与导师讨论 + 开题报告与 PPT' },
      { id: 'sp-kaogong', title: '28 考公正式备考启动', date: '2027-02-07', domain: 'kaogong', note: '农历春节后全面转入主线备考' }
    ],
    tasks: [
      {
        id: uid(), title: '看完统计学老师课件并总结 EViews 6.0 常用操作步骤', domain: 'study',
        status: 'in_progress', priority: 'high', deadline: '2026-12-04', today: true,
        desc: '对照 EViews 6.0 界面实操回归、异方差、自相关与平稳性检验，避免上机生疏', updatedAt: now
      },
      {
        id: uid(), title: '完成金融资产评估论文初稿与数据测算', domain: 'study',
        status: 'in_progress', priority: 'high', deadline: '2026-12-07', today: true,
        desc: '12月7日截稿，优先把核心估值框架与案例数据跑通', updatedAt: now
      },
      {
        id: uid(), title: '英语六级真题限时套卷训练（攻克上次差十几分的薄弱项）', domain: 'study',
        status: 'todo', priority: 'high', deadline: '2026-12-12', today: true,
        desc: '每天至少 1 篇精听或 2 篇仔细阅读，背高频写作翻译模板', updatedAt: now
      },
      {
        id: uid(), title: '整理硕士毕业论文开题框架并与导师约时间讨论', domain: 'research',
        status: 'in_progress', priority: 'high', deadline: '2026-12-20', today: true,
        desc: '明确研究问题、数据来源与实证方法，按导师意见持续迭代写作', updatedAt: now
      },
      {
        id: uid(), title: '准备硕士开题答辩 PPT 与文献综述终稿', domain: 'research',
        status: 'todo', priority: 'high', deadline: '2026-12-18', today: false,
        desc: '12月20日前后答辩，提前 2 天完成试讲演练', updatedAt: now
      },
      {
        id: uid(), title: '28 考公筹备：摸底岗位要求、体检标准与全年备考资料清单', domain: 'kaogong',
        status: 'todo', priority: 'medium', deadline: '2027-01-31', today: false,
        desc: '当前为筹备期，先选定行测/申论网课老师与刷题规划，春节后正式发力', updatedAt: now
      },
      {
        id: uid(), title: '恢复有氧跑步（3-5 公里）+ 清淡控糖饮食', domain: 'fitness',
        status: 'todo', priority: 'medium', deadline: todayISO(0), today: true,
        desc: '为 28 考公体检提前降体脂率与 BMI，循序渐进找回夏天减掉 20 斤时的状态', updatedAt: now
      }
    ],
    // Medication & Supplements (one-tap daily check-in + editable)
    meds: [
      { id: uid(), name: '护肝片（早 / 午）', dose: '每次 4 片 · 第 1 次', timing: '白天', logs: [], updatedAt: now },
      { id: uid(), name: '护肝片（晚）',     dose: '每次 4 片 · 第 2 次', timing: '晚间', logs: [], updatedAt: now },
      { id: uid(), name: '鱼油',             dose: '每日 1 次 · 随餐',    timing: '随餐', logs: [], updatedAt: now },
      { id: uid(), name: '氨糖',             dose: '每日 1 次',           timing: '随餐', logs: [], updatedAt: now },
      { id: uid(), name: '拜耳 One A Day',   dose: '复合维生素 · 每日 1 粒', timing: '白天', logs: [], updatedAt: now },
      { id: uid(), name: '甘氨酸镁',         dose: '睡前服用 · 助眠放松', timing: '睡前', logs: [], updatedAt: now }
    ],
    // Sleep tracker with positive reinforcement (ready for Apple Watch Ultra 2 JSON)
    sleepTargetBedtime: '23:30',
    sleepLogs: [
      { id: uid(), date: todayISO(-4), bedtime: '01:10', duration: 6.4, quality: 3, source: 'manual' },
      { id: uid(), date: todayISO(-3), bedtime: '00:35', duration: 6.8, quality: 3, source: 'manual' },
      { id: uid(), date: todayISO(-2), bedtime: '23:45', duration: 7.3, quality: 4, source: 'manual' },
      { id: uid(), date: todayISO(-1), bedtime: '23:20', duration: 7.6, quality: 4, source: 'manual' }
    ],
    habits: [
      { id: uid(), name: '跑步 / 有氧减脂（30分钟+）', domain: 'fitness', logs: [todayISO(-2), todayISO(-1)], updatedAt: now },
      { id: uid(), name: '健康减脂饮食（戒夜宵/控糖）', domain: 'fitness', logs: [todayISO(-1)], updatedAt: now },
      { id: uid(), name: '六级听力 / 单词打卡', domain: 'study', logs: [todayISO(-2), todayISO(-1)], updatedAt: now },
      { id: uid(), name: '开题论文推进（至少 300 字或精读 1 篇文献）', domain: 'research', logs: [todayISO(-1)], updatedAt: now }
    ],
    // Anniversaries & Birthdays (supports both Solar & Chinese Lunar!)
    anniversaries: [
      { id: uid(), title: '2027 农历春节（考公正式起跑线）', calendar: 'lunar', lunarMonth: 1, lunarDay: 1, recurring: true, updatedAt: now },
      { id: uid(), title: '示例：家人生日（点击可编辑/删除）', calendar: 'lunar', lunarMonth: 10, lunarDay: 15, recurring: true, updatedAt: now },
      { id: uid(), title: '2027 元旦跨年', calendar: 'solar', solarDate: '2027-01-01', recurring: true, updatedAt: now }
    ],
    notes: [
      { id: uid(), content: 'EViews 6.0 考试备忘：\n- 记住导入 Excel 数据的流程\n- 重点复习 OLS 回归、ADF 平稳性检验、White 检验与 Granger 因果检验', pinned: true, domain: 'study', updatedAt: now },
      { id: uid(), content: '导师讨论记录：\n把每次和导师沟通后需要修改的开题逻辑随手记在这里，方便写作时对照。', pinned: false, domain: 'research', updatedAt: now }
    ],
    bookmarks: [
      { id: uid(), name: 'Notion', url: 'https://www.notion.com/', icon: '📝', updatedAt: now },
      { id: uid(), name: 'Obsidian', url: 'https://obsidian.md/', icon: '💎', updatedAt: now },
      { id: uid(), name: 'Supabase', url: 'https://supabase.com/', icon: '⚡', updatedAt: now },
      { id: uid(), name: 'Vercel', url: 'https://vercel.com/', icon: '▲', updatedAt: now }
    ],
    focusSessions: []
  };
}
