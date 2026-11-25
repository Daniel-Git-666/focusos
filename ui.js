let appState = createPersonalInitialState();
let currentView = 'overview';
let activeDomain = 'all';
let searchQuery = '';
let toastTimer = null;

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* Crisp SVG Icons */
const ICONS = {
  check: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  cal: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  moon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  spark: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>`,
  pin: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`,
  x: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  arrow: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>`
};

/* Override indicator for compact floating dock */
StorageService.updateSaveIndicator = function(mode) {
  const dot = document.getElementById('saveStatusDot');
  const txt = document.getElementById('saveStatusText');
  if (!dot || !txt) return;
  if (mode === 'saving') {
    dot.classList.add('saving');
    txt.textContent = '保存中';
  } else {
    dot.classList.remove('saving');
    txt.textContent = `已保存 ${formatTimeHMS().slice(0, 5)}`;
  }
};

/* Pomodoro */
const pomo = {
  mode: 'focus',
  durations: { focus: 25 * 60, short: 5 * 60, long: 15 * 60 },
  remaining: 25 * 60,
  running: false,
  timerId: null,
  boundTaskId: ''
};

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.14, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.85);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.85);
  } catch {}
}

function togglePomo() {
  if (pomo.running) {
    clearInterval(pomo.timerId);
    pomo.running = false;
  } else {
    pomo.running = true;
    pomo.timerId = setInterval(() => {
      pomo.remaining--;
      if (pomo.remaining <= 0) {
        clearInterval(pomo.timerId);
        pomo.running = false;
        playChime();
        if (pomo.mode === 'focus') {
          const bound = appState.tasks.find(t => t.id === pomo.boundTaskId);
          appState.focusSessions.push({
            id: uid(), date: todayISO(0),
            minutes: Math.round(pomo.durations.focus / 60),
            taskTitle: bound ? bound.title : '自由专注',
            updatedAt: new Date().toISOString()
          });
          commitState();
          showToast('完成 1 轮专注，已记录');
        } else {
          showToast('休息结束');
        }
        pomo.remaining = pomo.durations[pomo.mode];
      }
      updatePomoDOM();
    }, 1000);
  }
  updatePomoDOM();
}

function resetPomo() {
  clearInterval(pomo.timerId);
  pomo.running = false;
  pomo.remaining = pomo.durations[pomo.mode];
  updatePomoDOM();
}

function setPomoMode(mode) {
  clearInterval(pomo.timerId);
  pomo.running = false;
  pomo.mode = mode;
  pomo.remaining = pomo.durations[mode];
  renderApp();
}

function updatePomoDOM() {
  const digits = document.getElementById('pomoDigits');
  const ring = document.getElementById('pomoRingCircle');
  const btn = document.getElementById('pomoStartBtn');
  if (!digits) return;
  const m = String(Math.floor(pomo.remaining / 60)).padStart(2, '0');
  const s = String(pomo.remaining % 60).padStart(2, '0');
  digits.textContent = `${m}:${s}`;
  const total = pomo.durations[pomo.mode];
  const circ = 2 * Math.PI * 54;
  ring.style.strokeDashoffset = circ * (1 - pomo.remaining / total);
  btn.textContent = pomo.running ? '暂停' : '开始';
}

function commitState() {
  StorageService.save(appState);
  renderApp();
  if (window.CloudSync) CloudSync.schedulePush();
}

/* Helpers */
function getFilteredTasks(domainSubset = null) {
  return appState.tasks.filter(t => {
    if (domainSubset && !domainSubset.includes(t.domain)) return false;
    if (activeDomain !== 'all' && t.domain !== activeDomain) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (t.title || '').toLowerCase().includes(q) || (t.desc || '').toLowerCase().includes(q);
    }
    return true;
  });
}

function getStreak(logs = []) {
  const set = new Set(logs);
  let streak = 0;
  let offset = set.has(todayISO(0)) ? 0 : -1;
  while (set.has(todayISO(offset))) { streak++; offset--; }
  return streak;
}

function bedtimeToMinutes(hhmm = '23:30') {
  const [h, m] = hhmm.split(':').map(Number);
  return (h < 12 ? h + 24 : h) * 60 + (m || 0);
}

function isEarlyBedtime(bedtime, target = '23:30') {
  return bedtimeToMinutes(bedtime) <= bedtimeToMinutes(target);
}

function getSleepStats() {
  const logs = [...(appState.sleepLogs || [])].sort((a, b) => a.date.localeCompare(b.date));
  const recent = logs.slice(-7);
  const avgDur = recent.length ? (recent.reduce((s, x) => s + Number(x.duration || 0), 0) / recent.length).toFixed(1) : '0.0';
  const target = appState.sleepTargetBedtime || '23:30';
  let earlyStreak = 0;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (isEarlyBedtime(logs[i].bedtime, target)) earlyStreak++;
    else break;
  }
  const latest = logs[logs.length - 1] || null;
  return { recent, avgDur, earlyStreak, latest, target };
}

function ddlText(dateStr) {
  const diff = diffDaysFromToday(dateStr);
  if (diff === null) return null;
  if (diff < 0) return { text: `逾期 ${Math.abs(diff)} 天`, cls: 'urgent' };
  if (diff === 0) return { text: '今天截止', cls: 'urgent' };
  if (diff === 1) return { text: '明天截止', cls: 'urgent' };
  if (diff <= 4) return { text: `剩 ${diff} 天`, cls: 'urgent' };
  if (diff <= 10) return { text: `剩 ${diff} 天`, cls: 'soon' };
  return { text: dateStr.slice(5), cls: '' };
}

function exportTaskToICS(taskId) {
  const task = appState.tasks.find(t => t.id === taskId);
  if (!task || !task.deadline) return;
  const dt = task.deadline.replace(/-/g, '');
  const nextDay = todayISO(diffDaysFromToday(task.deadline) + 1).replace(/-/g, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FocusOS//Personal Hub//CN',
    'BEGIN:VEVENT', `UID:${task.id}@focusos.local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART;VALUE=DATE:${dt}`, `DTEND;VALUE=DATE:${nextDay}`,
    `SUMMARY:[Deadline] ${task.title}`, `DESCRIPTION:${(task.desc || '').replace(/\n/g, '\\n')}`,
    'BEGIN:VALARM', 'TRIGGER:-PT9H', 'ACTION:DISPLAY', `DESCRIPTION:提醒：${task.title}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Deadline-${task.title.slice(0, 14)}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('已导出 .ics 日历文件');
}

/* Mutations */
function toggleTaskDone(taskId) {
  const t = appState.tasks.find(x => x.id === taskId);
  if (!t) return;
  t.status = (t.status === 'done') ? 'todo' : 'done';
  t.updatedAt = new Date().toISOString();
  commitState();
}

function quickAddTodayTask() {
  const input = document.getElementById('quickTaskInput');
  const domainSel = document.getElementById('quickTaskDomain');
  const title = input.value.trim();
  if (!title) return;
  appState.tasks.unshift({
    id: uid(), title, domain: domainSel ? domainSel.value : 'study',
    status: 'todo', priority: 'medium', deadline: '',
    today: true, desc: '', updatedAt: new Date().toISOString()
  });
  input.value = '';
  commitState();
  showToast('已添加并实时保存');
}

function moveTaskStatus(taskId, newStatus) {
  const t = appState.tasks.find(x => x.id === taskId);
  if (!t || t.status === newStatus) return;
  t.status = newStatus;
  t.updatedAt = new Date().toISOString();
  commitState();
}

function toggleMedToday(medId) {
  const m = appState.meds.find(x => x.id === medId);
  if (!m) return;
  const today = todayISO(0);
  m.logs = m.logs || [];
  const idx = m.logs.indexOf(today);
  if (idx >= 0) m.logs.splice(idx, 1);
  else {
    m.logs.push(today);
    const takenNow = appState.meds.filter(x => (x.logs || []).includes(today)).length;
    showToast(takenNow === appState.meds.length ? '今日全部保健品已打卡完成' : `已打卡 · ${m.name}`);
  }
  m.updatedAt = new Date().toISOString();
  commitState();
}

function toggleHabitDay(habitId, dateStr) {
  const h = appState.habits.find(x => x.id === habitId);
  if (!h) return;
  h.logs = h.logs || [];
  const idx = h.logs.indexOf(dateStr);
  if (idx >= 0) h.logs.splice(idx, 1);
  else h.logs.push(dateStr);
  h.updatedAt = new Date().toISOString();
  commitState();
}

function deleteHabit(habitId) {
  appState.habits = appState.habits.filter(h => h.id !== habitId);
  commitState();
}

function deleteAnniversary(id) {
  appState.anniversaries = appState.anniversaries.filter(a => a.id !== id);
  commitState();
}

function addQuickNote() {
  appState.notes.unshift({
    id: uid(), content: '', pinned: false,
    domain: activeDomain === 'all' ? 'study' : activeDomain,
    updatedAt: new Date().toISOString()
  });
  commitState();
  setTimeout(() => {
    const firstArea = document.querySelector('.note-card textarea');
    if (firstArea) firstArea.focus();
  }, 30);
}

let noteSaveTimer = null;
function updateNoteContent(id, value, immediate = false) {
  const n = appState.notes.find(x => x.id === id);
  if (!n) return;
  n.content = value;
  n.updatedAt = new Date().toISOString();
  clearTimeout(noteSaveTimer);
  if (immediate) StorageService.save(appState);
  else noteSaveTimer = setTimeout(() => StorageService.save(appState), 300);
}

function toggleNotePin(id) {
  const n = appState.notes.find(x => x.id === id);
  if (!n) return;
  n.pinned = !n.pinned;
  n.updatedAt = new Date().toISOString();
  commitState();
}

function deleteNote(id) {
  appState.notes = appState.notes.filter(x => x.id !== id);
  commitState();
}

function setDomainFilter(dom) {
  activeDomain = dom;
  renderApp();
}

/* Sculpted Section Renderers */
function renderHeroHeader(eyebrow, title, showDomainFilter = false) {
  return `
    <div class="hero-header">
      <div>
        <div class="hero-eyebrow">${eyebrow}</div>
        <h1 class="hero-title">${title}</h1>
      </div>
      ${showDomainFilter ? `
        <div class="hero-meta-pills">
          <button class="filter-chip ${activeDomain === 'all' ? 'active' : ''}" onclick="setDomainFilter('all')">全部</button>
          ${Object.entries(DOMAINS).map(([k, d]) => `
            <button class="filter-chip ${activeDomain === k ? 'active' : ''}" onclick="setDomainFilter('${k}')">
              <span class="dot" style="background:${activeDomain === k ? '#fff' : d.color}"></span>${d.short}
            </button>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function renderTimelineCard() {
  const sprints = appState.sprints || [];
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-label">Milestones</div>
          <div class="card-title">12 月冲刺与 28 考公主线</div>
        </div>
        <button class="btn-link" onclick="switchView('study_space')">进入学习空间</button>
      </div>
      <div class="timeline-track">
        ${sprints.map((sp, idx) => {
          const diff = diffDaysFromToday(sp.date);
          const isNearest = idx === 0;
          return `
            <div class="tl-node ${isNearest ? 'nearest' : ''} ${sp.domain}">
              <span class="tl-date">${sp.date.slice(5)}</span>
              <div class="tl-dot-wrap">
                <span class="tl-dot"></span>
              </div>
              <div class="tl-days">${diff >= 0 ? diff : 0}<span>天</span></div>
              <div class="tl-name">${escapeHtml(sp.title)}</div>
              <div class="tl-note">${escapeHtml(sp.note || '')}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderMedsCard() {
  const today = todayISO(0);
  const meds = appState.meds || [];
  const taken = meds.filter(m => (m.logs || []).includes(today)).length;
  const pct = meds.length ? taken / meds.length : 0;
  const circ = 2 * Math.PI * 14;

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-label">Daily Ritual</div>
          <div class="card-title">吃药与保健品</div>
        </div>
        <div class="med-head-right">
          <div class="mini-ring">
            <svg width="34" height="34" viewBox="0 0 34 34">
              <circle cx="17" cy="17" r="14" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="3"></circle>
              <circle cx="17" cy="17" r="14" fill="none" stroke="#249F58" stroke-width="3" stroke-linecap="round"
                stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}"></circle>
            </svg>
            <span class="mini-ring-text">${taken}/${meds.length}</span>
          </div>
          <button class="btn-link" onclick="openManageMedsModal()">编辑</button>
        </div>
      </div>
      <div class="med-tray">
        ${meds.map(m => {
          const isTaken = (m.logs || []).includes(today);
          const streak = getStreak(m.logs);
          return `
            <button class="med-capsule ${isTaken ? 'taken' : ''}" onclick="toggleMedToday('${m.id}')">
              <span class="cap-check">${ICONS.check}</span>
              <div>
                <div class="cap-name">${escapeHtml(m.name)}</div>
                <div class="cap-sub">${escapeHtml(m.dose)}${streak > 0 ? ` · ${streak}天` : ''}</div>
              </div>
            </button>
          `;
        }).join('')}
      </div>
      ${meds.length > 0 && taken === meds.length ? `
        <div class="med-done-note">${ICONS.spark} 今日全部服用打卡完成</div>
      ` : ''}
    </div>
  `;
}

function renderTaskRow(t) {
  const dom = DOMAINS[t.domain] || DOMAINS.study;
  const ddl = ddlText(t.deadline);
  const isDone = t.status === 'done';
  return `
    <div class="clean-row ${isDone ? 'done' : ''}">
      <button class="circle-check ${isDone ? 'checked' : ''}" onclick="toggleTaskDone('${t.id}')">${ICONS.check}</button>
      <div class="row-body" onclick="openTaskModal('${t.id}')">
        <div class="row-title">${escapeHtml(t.title)}</div>
        <div class="row-meta">
          <span class="row-domain"><span class="dot" style="background:${dom.color}"></span>${dom.short}</span>
          ${ddl ? `<span class="row-ddl ${ddl.cls}">${ddl.text}</span>` : ''}
        </div>
      </div>
      ${t.deadline ? `<button class="icon-btn" onclick="exportTaskToICS('${t.id}')" title="导出到苹果日历 (.ics)">${ICONS.cal}</button>` : ''}
    </div>
  `;
}

function renderSleepCard() {
  const st = getSleepStats();
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const tip = st.earlyStreak >= 2
    ? `连续 ${st.earlyStreak} 晚在 ${st.target} 前入睡，节律正在建立`
    : (st.earlyStreak === 1
      ? `昨晚早睡达标，今晚继续保持连击`
      : `目标 ${st.target} 前入睡，睡前搭配甘氨酸镁更易放松`);

  return `
    <div class="card night-card">
      <div class="card-head">
        <div>
          <div class="card-label">Sleep Rhythm</div>
          <div class="card-title">睡眠与早睡激励</div>
        </div>
        <button class="btn-subtle" onclick="openAddSleepModal()">记录昨晚</button>
      </div>
      <div class="night-stats">
        <div>
          <div class="night-stat-label">7日均时长</div>
          <div class="night-stat-val">${st.avgDur}h</div>
        </div>
        <div>
          <div class="night-stat-label">昨晚入睡</div>
          <div class="night-stat-val">${st.latest ? st.latest.bedtime : '--:--'}</div>
        </div>
        <div>
          <div class="night-stat-label">早睡连击</div>
          <div class="night-stat-val mint">${st.earlyStreak} 天</div>
        </div>
      </div>
      <div class="night-chart">
        ${Array.from({ length: 7 }, (_, i) => todayISO(i - 6)).map(d => {
          const log = (appState.sleepLogs || []).find(x => x.date === d);
          const wd = dayNames[new Date(d + 'T00:00:00').getDay()];
          if (!log) {
            return `
              <div class="night-bar-col" title="${d} · 未记录">
                <div class="night-bar" style="height:16%;opacity:0.35"></div>
                <span class="night-bar-day">${wd}</span>
              </div>
            `;
          }
          const hPct = Math.min(100, Math.max(22, Math.round((Number(log.duration || 0) / 9) * 100)));
          const early = isEarlyBedtime(log.bedtime, st.target);
          return `
            <div class="night-bar-col" title="${log.date} · 入睡 ${log.bedtime} · ${log.duration}h">
              <div class="night-bar ${early ? 'early' : 'late'}" style="height:${hPct}%"></div>
              <span class="night-bar-day">${wd}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="night-caption">${ICONS.moon}<span>${tip}</span></div>
    </div>
  `;
}

function renderHabitsCard() {
  const last7 = Array.from({ length: 7 }, (_, i) => todayISO(i - 6));
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const todayAct = (appState.activityLogs || []).find(a => a.date === todayISO(0));
  const actBadge = todayAct
    ? `<div style="font-size:11.5px;color:var(--sage);font-weight:600;margin-top:3px;">Apple Watch 今日 · ${todayAct.runningKm || 0} km · ${todayAct.activeKcal || 0} kcal</div>`
    : '';
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-label">Habits</div>
          <div class="card-title">减脂与日常习惯</div>
          ${actBadge}
        </div>
        <button class="btn-link" onclick="openAddHabit()">添加</button>
      </div>
      <div>
        ${appState.habits.map(h => `
          <div class="habit-item">
            <div>
              <div class="habit-name">${escapeHtml(h.name)}</div>
              <div class="habit-streak">连续 ${getStreak(h.logs)} 天</div>
            </div>
            <div class="habit-dots">
              ${last7.map(d => {
                const checked = (h.logs || []).includes(d);
                const wd = dayLabels[new Date(d + 'T00:00:00').getDay()];
                return `<button class="h-dot ${checked ? 'done' : ''} ${d === todayISO(0) ? 'today' : ''}" onclick="toggleHabitDay('${h.id}','${d}')" title="${d}">${checked ? ICONS.check : wd}</button>`;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderAnniversaryCard() {
  const items = (appState.anniversaries || []).map(item => ({
    ...item,
    resolved: resolveNextAnniversaryDate(item)
  })).sort((a, b) => (a.resolved.diffDays ?? 999) - (b.resolved.diffDays ?? 999));

  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-label">Dates</div>
          <div class="card-title">生日与纪念日</div>
        </div>
        <button class="btn-link" onclick="openAddAnniversaryModal()">添加</button>
      </div>
      <div>
        ${items.map(it => `
          <div class="anniv-row">
            <div>
              <div class="anniv-title">
                ${escapeHtml(it.title)}
                <span class="cal-tag ${it.calendar === 'lunar' ? 'lunar' : ''}">${it.calendar === 'lunar' ? '农历' : '公历'}</span>
              </div>
              <div class="anniv-sub">${it.resolved.displayLabel}${it.calendar === 'lunar' && it.resolved.nextSolar ? ` · ${it.resolved.nextSolar}` : ''}</div>
            </div>
            <div class="anniv-right">
              <span class="anniv-num">${it.resolved.diffDays ?? '--'}</span>
              <span class="anniv-unit">天</span>
              <button class="icon-btn danger" onclick="deleteAnniversary('${it.id}')" title="删除">${ICONS.x}</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderPomoCard() {
  const circ = 2 * Math.PI * 54;
  return `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-label">Focus Timer</div>
          <div class="card-title">专注番茄钟</div>
        </div>
      </div>
      <div class="pomo-studio">
        <div class="pomo-seg">
          <button class="${pomo.mode === 'focus' ? 'active' : ''}" onclick="setPomoMode('focus')">25m</button>
          <button class="${pomo.mode === 'short' ? 'active' : ''}" onclick="setPomoMode('short')">5m</button>
          <button class="${pomo.mode === 'long' ? 'active' : ''}" onclick="setPomoMode('long')">15m</button>
        </div>
        <div class="pomo-dial">
          <svg width="126" height="126" viewBox="0 0 126 126">
            <circle cx="63" cy="63" r="54" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="5"></circle>
            <circle id="pomoRingCircle" cx="63" cy="63" r="54" fill="none" stroke="#18181B" stroke-width="5" stroke-linecap="round"
              stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pomo.remaining / pomo.durations[pomo.mode])}"></circle>
          </svg>
          <div class="pomo-dial-text">
            <div class="pomo-digits" id="pomoDigits">${String(Math.floor(pomo.remaining / 60)).padStart(2, '0')}:${String(pomo.remaining % 60).padStart(2, '0')}</div>
            <div class="pomo-sub">${pomo.mode === 'focus' ? '专注' : '休息'}</div>
          </div>
        </div>
        <div class="pomo-btns">
          <button class="btn-obsidian" id="pomoStartBtn" onclick="togglePomo()">${pomo.running ? '暂停' : '开始'}</button>
          <button class="btn-subtle" onclick="resetPomo()">重置</button>
        </div>
      </div>
    </div>
  `;
}

/* Page Views */
function renderOverview() {
  const now = new Date();
  const hr = now.getHours();
  const greet = hr < 12 ? '早上好' : (hr < 18 ? '下午好' : '晚上好');
  const dateStr = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const todayTasks = getFilteredTasks().filter(t => t.today).sort((a, b) => (a.status === 'done') - (b.status === 'done'));

  return `
    ${renderHeroHeader(dateStr, `${greet}，按节奏推进今天`, true)}

    <section class="bento-hero">
      ${renderTimelineCard()}
      ${renderMedsCard()}
    </section>

    <section class="bento-main">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-label">Today Focus</div>
            <div class="card-title">今日聚焦待办</div>
          </div>
          <button class="btn-link" onclick="switchView('kanban')">查看看板</button>
        </div>
        <div class="clean-list">
          ${todayTasks.length ? todayTasks.map(renderTaskRow).join('') : '<div class="empty-state">今日暂无聚焦待办</div>'}
        </div>
        <div class="inline-add-bar">
          <input type="text" id="quickTaskInput" placeholder="输入新待办，按回车立刻保存..." onkeydown="if(event.key==='Enter') quickAddTodayTask()" />
          <select id="quickTaskDomain">
            <option value="study">学业</option>
            <option value="research">论文</option>
            <option value="kaogong">28考公</option>
            <option value="fitness">减脂</option>
            <option value="reading">阅读</option>
          </select>
          <button class="btn-obsidian" onclick="quickAddTodayTask()">添加</button>
        </div>
      </div>

      ${renderSleepCard()}
    </section>

    <section class="bento-trio">
      ${renderHabitsCard()}
      ${renderAnniversaryCard()}
      ${renderPomoCard()}
    </section>
  `;
}

function renderStudySpace() {
  const studyTasks = getFilteredTasks(['study', 'research', 'kaogong'])
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (diffDaysFromToday(a.deadline) ?? 999) - (diffDaysFromToday(b.deadline) ?? 999));

  return `
    ${renderHeroHeader('Study & Career', '学习冲刺与 28 考公', false)}
    <div style="margin-bottom:20px;">${renderTimelineCard()}</div>
    <section class="bento-main">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-label">Action Items</div>
            <div class="card-title">考试、开题与考公任务</div>
          </div>
          <button class="btn-link" onclick="switchView('kanban')">切换拖拽看板</button>
        </div>
        <div class="clean-list">
          ${studyTasks.length ? studyTasks.map(renderTaskRow).join('') : '<div class="empty-state">暂无学习任务</div>'}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px;">
        ${renderPomoCard()}
        <div class="card">
          <div class="card-head">
            <div>
              <div class="card-label">Quick Links</div>
              <div class="card-title">常用网站</div>
            </div>
            <button class="btn-link" onclick="openAddBookmark()">添加</button>
          </div>
          <div class="bm-grid">
            ${appState.bookmarks.map(b => `
              <a class="bm-link" href="${escapeHtml(b.url)}" target="_blank" rel="noopener noreferrer">
                <span>${escapeHtml(b.name)}</span>
                ${ICONS.arrow}
              </a>
            `).join('')}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderLifeSpace() {
  const lifeTasks = getFilteredTasks(['fitness', 'reading']);
  return `
    ${renderHeroHeader('Wellness & Life', '生活、健康与重要日子', false)}
    <section class="bento-duo">
      ${renderMedsCard()}
      ${renderSleepCard()}
    </section>
    <section class="bento-duo">
      ${renderHabitsCard()}
      ${renderAnniversaryCard()}
    </section>
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-label">Fitness & Life</div>
          <div class="card-title">减脂与生活待办</div>
        </div>
      </div>
      <div class="clean-list">
        ${lifeTasks.length ? lifeTasks.map(renderTaskRow).join('') : '<div class="empty-state">暂无生活类待办</div>'}
      </div>
    </div>
  `;
}

function renderKanban() {
  const tasks = getFilteredTasks();
  return `
    ${renderHeroHeader('Kanban Board', '全量任务看板', true)}
    <div class="kanban-grid">
      ${Object.entries(STATUSES).map(([statusKey, info]) => {
        const colTasks = tasks.filter(t => t.status === statusKey);
        return `
          <div class="k-col" data-status="${statusKey}"
            ondragover="event.preventDefault(); this.classList.add('drag-over')"
            ondragleave="this.classList.remove('drag-over')"
            ondrop="handleKanbanDrop(event, '${statusKey}', this)">
            <div class="k-col-head">
              <span style="display:flex;align-items:center;gap:7px;"><span class="dot" style="background:${info.color}"></span>${info.label}</span>
              <span style="color:var(--ink-tertiary);font-size:12px;">${colTasks.length}</span>
            </div>
            <div class="k-cards">
              ${colTasks.map(t => {
                const dom = DOMAINS[t.domain] || DOMAINS.study;
                const ddl = ddlText(t.deadline);
                return `
                  <div class="k-card" draggable="true"
                    ondragstart="event.dataTransfer.setData('text/plain', '${t.id}')"
                    onclick="openTaskModal('${t.id}')">
                    <div class="k-card-title">${escapeHtml(t.title)}</div>
                    ${t.desc ? `<div class="k-card-desc">${escapeHtml(t.desc)}</div>` : ''}
                    <div class="k-card-foot">
                      <span class="row-domain"><span class="dot" style="background:${dom.color}"></span>${dom.short}</span>
                      ${ddl ? `<span class="row-ddl ${ddl.cls}">${ddl.text}</span>` : ''}
                    </div>
                  </div>
                `;
              }).join('') || '<div class="empty-state">拖拽卡片至此</div>'}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function handleKanbanDrop(e, newStatus, colEl) {
  e.preventDefault();
  colEl.classList.remove('drag-over');
  const taskId = e.dataTransfer.getData('text/plain');
  if (taskId) moveTaskStatus(taskId, newStatus);
}

function renderNotesView() {
  const filtered = [...appState.notes]
    .filter(n => !searchQuery || n.content.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  return `
    <div class="hero-header">
      <div>
        <div class="hero-eyebrow">Quick Capture</div>
        <h1 class="hero-title">灵感便签与导师记录</h1>
      </div>
      <button class="btn-obsidian" onclick="addQuickNote()">新建便签</button>
    </div>
    <div class="notes-grid">
      ${filtered.map(n => `
        <div class="note-card ${n.pinned ? 'pinned' : ''}">
          <textarea placeholder="随时记下复习要点、导师反馈或想法..." oninput="updateNoteContent('${n.id}', this.value)" onblur="updateNoteContent('${n.id}', this.value, true)">${escapeHtml(n.content)}</textarea>
          <div class="note-foot">
            <span>${n.pinned ? '已置顶' : '自动保存'}</span>
            <div style="display:flex;gap:4px;">
              <button class="icon-btn" onclick="toggleNotePin('${n.id}')" title="置顶">${ICONS.pin}</button>
              <button class="icon-btn danger" onclick="deleteNote('${n.id}')" title="删除">${ICONS.x}</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function updateBadges() {
  const openTasks = appState.tasks.filter(t => t.status !== 'done');
  const today = todayISO(0);
  const takenMeds = (appState.meds || []).filter(m => (m.logs || []).includes(today)).length;
  document.getElementById('badge-study-space').textContent = openTasks.filter(t => ['study', 'research', 'kaogong'].includes(t.domain)).length;
  document.getElementById('badge-meds').textContent = `${takenMeds}/${(appState.meds || []).length}`;
  document.getElementById('badge-all').textContent = openTasks.length;
  document.getElementById('badge-notes').textContent = appState.notes.length;
}

function renderApp() {
  updateBadges();
  const root = document.getElementById('viewRoot');
  if (currentView === 'overview') root.innerHTML = renderOverview();
  else if (currentView === 'study_space') root.innerHTML = renderStudySpace();
  else if (currentView === 'life_space') root.innerHTML = renderLifeSpace();
  else if (currentView === 'kanban') root.innerHTML = renderKanban();
  else if (currentView === 'notes') root.innerHTML = renderNotesView();
}

function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('#mainNav .dock-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  renderApp();
}

/* Modals */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function openTaskModal(taskId = null) {
  const form = document.getElementById('taskForm');
  const delBtn = document.getElementById('tf-deleteBtn');
  form.reset();
  if (taskId) {
    const t = appState.tasks.find(x => x.id === taskId);
    if (!t) return;
    document.getElementById('taskModalTitle').textContent = '编辑任务';
    document.getElementById('tf-id').value = t.id;
    document.getElementById('tf-title').value = t.title;
    document.getElementById('tf-domain').value = t.domain;
    document.getElementById('tf-status').value = t.status;
    document.getElementById('tf-deadline').value = t.deadline || '';
    document.getElementById('tf-priority').value = t.priority || 'medium';
    document.getElementById('tf-today').checked = Boolean(t.today);
    document.getElementById('tf-desc').value = t.desc || '';
    delBtn.style.display = 'inline-flex';
    delBtn.onclick = () => {
      appState.tasks = appState.tasks.filter(x => x.id !== t.id);
      closeModal('taskModal');
      commitState();
      showToast('任务已删除');
    };
  } else {
    document.getElementById('taskModalTitle').textContent = '新建任务';
    document.getElementById('tf-id').value = '';
    if (activeDomain !== 'all') document.getElementById('tf-domain').value = activeDomain;
    document.getElementById('tf-today').checked = (currentView === 'overview');
    delBtn.style.display = 'none';
  }
  openModal('taskModal');
  setTimeout(() => document.getElementById('tf-title').focus(), 40);
}

function openManageMedsModal() {
  document.getElementById('miniModalTitle').textContent = '编辑吃药与保健品清单';
  const renderList = () => {
    document.getElementById('miniModalBody').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;max-height:240px;overflow-y:auto;">
        ${appState.meds.map(m => `
          <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surface-muted);padding:10px 12px;border-radius:10px;">
            <div>
              <div style="font-weight:600;font-size:13px;">${escapeHtml(m.name)}</div>
              <div style="font-size:11.5px;color:var(--ink-tertiary);">${escapeHtml(m.dose)}</div>
            </div>
            <button class="icon-btn danger" onclick="deleteMedItem('${m.id}')">${ICONS.x}</button>
          </div>
        `).join('')}
      </div>
      <form onsubmit="submitNewMed(event)" style="border-top:1px solid var(--hairline);padding-top:14px;">
        <div class="form-group">
          <label>名称 *</label>
          <input class="form-control" id="mm-name" placeholder="例如：维生素 D3" required />
        </div>
        <div class="form-group">
          <label>剂量与服用说明 *</label>
          <input class="form-control" id="mm-dose" placeholder="例如：每次 1 粒 · 随餐" required />
        </div>
        <div class="modal-foot">
          <span></span>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn-subtle" onclick="closeModal('miniModal')">完成</button>
            <button type="submit" class="btn-obsidian">添加</button>
          </div>
        </div>
      </form>
    `;
  };
  window.deleteMedItem = (id) => { appState.meds = appState.meds.filter(x => x.id !== id); commitState(); renderList(); };
  window.submitNewMed = (e) => {
    e.preventDefault();
    appState.meds.push({
      id: uid(), name: document.getElementById('mm-name').value.trim(),
      dose: document.getElementById('mm-dose').value.trim(), timing: '每日', logs: [], updatedAt: new Date().toISOString()
    });
    commitState(); renderList(); showToast('已添加到清单');
  };
  renderList();
  openModal('miniModal');
}

function openAddSleepModal() {
  document.getElementById('miniModalTitle').textContent = '记录昨晚睡眠';
  document.getElementById('miniModalBody').innerHTML = `
    <form onsubmit="submitSleepLog(event)">
      <div class="form-row">
        <div class="form-group"><label>日期</label><input type="date" class="form-control" id="sl-date" value="${todayISO(0)}" required /></div>
        <div class="form-group"><label>目标入睡时间</label><input type="time" class="form-control" id="sl-target" value="${appState.sleepTargetBedtime || '23:30'}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>实际入睡时间 *</label><input type="time" class="form-control" id="sl-bedtime" value="23:25" required /></div>
        <div class="form-group"><label>睡眠时长（小时）*</label><input type="number" step="0.1" min="1" max="15" class="form-control" id="sl-dur" value="7.5" required /></div>
      </div>
      <div class="modal-foot">
        <span></span>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-subtle" onclick="closeModal('miniModal')">取消</button>
          <button type="submit" class="btn-obsidian">保存</button>
        </div>
      </div>
    </form>
  `;
  openModal('miniModal');
}

function submitSleepLog(e) {
  e.preventDefault();
  const date = document.getElementById('sl-date').value;
  const bedtime = document.getElementById('sl-bedtime').value;
  const duration = parseFloat(document.getElementById('sl-dur').value);
  appState.sleepTargetBedtime = document.getElementById('sl-target').value || '23:30';
  appState.sleepLogs = (appState.sleepLogs || []).filter(x => x.date !== date);
  appState.sleepLogs.push({ id: uid(), date, bedtime, duration, quality: 4, source: 'manual' });
  closeModal('miniModal');
  commitState();
  showToast(isEarlyBedtime(bedtime, appState.sleepTargetBedtime) ? '早睡达标，连击 +1' : '已记录昨晚睡眠');
}

function openAddAnniversaryModal() {
  document.getElementById('miniModalTitle').textContent = '添加生日 / 纪念日';
  document.getElementById('miniModalBody').innerHTML = `
    <form onsubmit="submitAnniversary(event)">
      <div class="form-group"><label>名称 *</label><input class="form-control" id="an-title" placeholder="例如：妈妈生日" required /></div>
      <div class="form-group">
        <label>历法</label>
        <select class="form-control" id="an-cal" onchange="toggleAnnivCalFields(this.value)">
          <option value="lunar">农历（自动换算每年公历日期）</option>
          <option value="solar">公历</option>
        </select>
      </div>
      <div id="an-lunar-fields" class="form-row">
        <div class="form-group"><label>农历月份</label><select class="form-control" id="an-lm">${LUNAR_MONTH_NAMES.slice(1).map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></div>
        <div class="form-group"><label>农历日期</label><select class="form-control" id="an-ld">${LUNAR_DAY_NAMES.slice(1).map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select></div>
      </div>
      <div id="an-solar-fields" class="form-group" style="display:none;"><label>公历日期</label><input type="date" class="form-control" id="an-sd" value="${todayISO(30)}" /></div>
      <div class="modal-foot">
        <span></span>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-subtle" onclick="closeModal('miniModal')">取消</button>
          <button type="submit" class="btn-obsidian">保存</button>
        </div>
      </div>
    </form>
  `;
  openModal('miniModal');
}

function toggleAnnivCalFields(val) {
  document.getElementById('an-lunar-fields').style.display = (val === 'lunar') ? 'grid' : 'none';
  document.getElementById('an-solar-fields').style.display = (val === 'solar') ? 'block' : 'none';
}

function submitAnniversary(e) {
  e.preventDefault();
  const cal = document.getElementById('an-cal').value;
  const item = { id: uid(), title: document.getElementById('an-title').value.trim(), calendar: cal, recurring: true, updatedAt: new Date().toISOString() };
  if (cal === 'lunar') { item.lunarMonth = parseInt(document.getElementById('an-lm').value, 10); item.lunarDay = parseInt(document.getElementById('an-ld').value, 10); }
  else item.solarDate = document.getElementById('an-sd').value;
  appState.anniversaries.push(item);
  closeModal('miniModal');
  commitState();
  showToast('已添加纪念日');
}

function openAddHabit() {
  document.getElementById('miniModalTitle').textContent = '新建习惯';
  document.getElementById('miniModalBody').innerHTML = `
    <form onsubmit="submitHabit(event)">
      <div class="form-group"><label>习惯名称 *</label><input class="form-control" id="mh-name" placeholder="例如：跑步 3 公里 / 戒夜宵" required /></div>
      <div class="modal-foot">
        <span></span>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-subtle" onclick="closeModal('miniModal')">取消</button>
          <button type="submit" class="btn-obsidian">保存</button>
        </div>
      </div>
    </form>
  `;
  openModal('miniModal');
}

function submitHabit(e) {
  e.preventDefault();
  appState.habits.push({ id: uid(), name: document.getElementById('mh-name').value.trim(), domain: 'fitness', logs: [], updatedAt: new Date().toISOString() });
  closeModal('miniModal');
  commitState();
  showToast('已添加习惯');
}

function openAddBookmark() {
  document.getElementById('miniModalTitle').textContent = '添加常用网站';
  document.getElementById('miniModalBody').innerHTML = `
    <form onsubmit="submitBookmark(event)">
      <div class="form-group"><label>网站名称 *</label><input class="form-control" id="mb-name" placeholder="例如：中国知网" required /></div>
      <div class="form-group"><label>网址 URL *</label><input type="url" class="form-control" id="mb-url" placeholder="https://..." required /></div>
      <div class="modal-foot">
        <span></span>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-subtle" onclick="closeModal('miniModal')">取消</button>
          <button type="submit" class="btn-obsidian">保存</button>
        </div>
      </div>
    </form>
  `;
  openModal('miniModal');
}

function submitBookmark(e) {
  e.preventDefault();
  appState.bookmarks.push({ id: uid(), name: document.getElementById('mb-name').value.trim(), url: document.getElementById('mb-url').value.trim(), icon: '', updatedAt: new Date().toISOString() });
  closeModal('miniModal');
  commitState();
  showToast('已添加网站');
}

function exportBackupJSON() {
  const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `FocusOS-Backup-${todayISO(0)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('已导出 JSON 备份');
}

/* Events */
document.querySelectorAll('#mainNav .dock-tab').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
document.getElementById('globalSearch').addEventListener('input', (e) => { searchQuery = e.target.value.trim(); renderApp(); });
document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal(null));
document.getElementById('modalExportBtn').addEventListener('click', exportBackupJSON);
document.getElementById('openSettingsBtn').addEventListener('click', () => {
  document.getElementById('storageStatsText').textContent = `${appState.tasks.length} 条任务 · ${appState.meds.length} 项保健品 · ${appState.sleepLogs.length} 条睡眠 · ${appState.anniversaries.length} 个纪念日`;
  openModal('settingsModal');
});

document.getElementById('taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = document.getElementById('tf-id').value;
  const payload = {
    id: id || uid(),
    title: document.getElementById('tf-title').value.trim(),
    domain: document.getElementById('tf-domain').value,
    status: document.getElementById('tf-status').value,
    deadline: document.getElementById('tf-deadline').value,
    priority: document.getElementById('tf-priority').value,
    today: document.getElementById('tf-today').checked,
    desc: document.getElementById('tf-desc').value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (id) { const idx = appState.tasks.findIndex(t => t.id === id); if (idx >= 0) appState.tasks[idx] = payload; }
  else appState.tasks.unshift(payload);
  closeModal('taskModal');
  commitState();
  showToast(id ? '任务已更新' : '已保存');
});

document.getElementById('importFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!parsed.tasks) throw new Error('invalid');
      appState = parsed; commitState(); closeModal('settingsModal'); showToast('备份已恢复');
    } catch { showToast('备份文件格式无效'); }
  };
  reader.readAsText(file); e.target.value = '';
});

document.getElementById('importHealthInput').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      const metrics = data?.data?.metrics || [];
      const sleepMetric = metrics.find(m => (m.name || '').toLowerCase().includes('sleep'));
      let imported = 0;
      if (sleepMetric && Array.isArray(sleepMetric.data)) {
        sleepMetric.data.forEach(item => {
          const date = (item.date || '').slice(0, 10);
          const hrs = Number(item.asleep || item.totalSleep || item.qty || 0);
          if (date && hrs > 0) {
            appState.sleepLogs = (appState.sleepLogs || []).filter(x => x.date !== date);
            appState.sleepLogs.push({ id: uid(), date, bedtime: '23:30', duration: Number(hrs.toFixed(1)), quality: 4, source: 'apple_watch' });
            imported++;
          }
        });
      }
      if (imported > 0) { commitState(); closeModal('settingsModal'); showToast(`已导入 ${imported} 条睡眠记录`); }
      else showToast('未识别到标准睡眠字段');
    } catch { showToast('JSON 解析失败'); }
  };
  reader.readAsText(file); e.target.value = '';
});

document.getElementById('resetDemoBtn').addEventListener('click', () => {
  appState = createPersonalInitialState(); commitState(); closeModal('settingsModal'); showToast('已重置为初始数据');
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('globalSearch').focus(); }
  if (e.key === 'Escape') ['taskModal', 'settingsModal', 'miniModal'].forEach(closeModal);
});

window.addEventListener('beforeunload', () => { try { localStorage.setItem(StorageService.LS_KEY, JSON.stringify(appState)); } catch {} });
document.querySelectorAll('.modal-backdrop').forEach(bd => bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); }));

(async function boot() {
  if (window.location.protocol === 'file:') document.getElementById('protocolBanner').classList.add('show');
  const saved = await StorageService.load();
  if (saved && Array.isArray(saved.tasks) && Array.isArray(saved.meds)) appState = saved;
  else { appState = createPersonalInitialState(); StorageService.save(appState, true); }
  StorageService.updateSaveIndicator('saved');
  renderApp();
  if (window.CloudSync) CloudSync.init();
})();

document.getElementById('openSettingsBtn').addEventListener('click', () => {
  const inp = document.getElementById('sync-key-input');
  if (inp && CloudSync.syncKey) inp.value = CloudSync.syncKey;
  CloudSync.updateUI();
});

document.getElementById('genSyncKeyBtn')?.addEventListener('click', () => {
  const inp = document.getElementById('sync-key-input');
  if (inp) inp.value = CloudSync.generateRandomKey();
});

document.getElementById('saveSyncKeyBtn')?.addEventListener('click', async () => {
  const val = document.getElementById('sync-key-input')?.value || '';
  await CloudSync.activateKey(val);
});

document.getElementById('copyMagicLinkBtn')?.addEventListener('click', () => {
  const link = CloudSync.getMagicLink();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link).then(() => showToast('已复制免登录专属链接，发给 iPad / iPhone 打开即可'));
  } else {
    prompt('复制下方免登录专属链接：', link);
  }
});

document.getElementById('sbSyncNowBtn')?.addEventListener('click', async () => {
  await CloudSync.pullAndMerge(false);
});

document.getElementById('sbSignOutBtn')?.addEventListener('click', async () => {
  await CloudSync.disconnect();
});

document.getElementById('copyAwUrlBtn')?.addEventListener('click', () => {
  const v = document.getElementById('aw-endpoint')?.value;
  if (v) { navigator.clipboard?.writeText(v); showToast('已复制推送接口 URL'); }
});

document.getElementById('copyAwTokenBtn')?.addEventListener('click', () => {
  const v = document.getElementById('aw-token')?.value;
  if (v && CloudSync.syncKey) { navigator.clipboard?.writeText(v); showToast('已复制同步口令 p_key'); }
  else showToast('请先在上方设置并保存同步口令');
});

document.getElementById('testHealthIngestBtn')?.addEventListener('click', () => {
  CloudSync.testHealthIngest();
});

window.addEventListener('focus', () => {
  if (window.CloudSync && CloudSync.syncKey) CloudSync.pullAndMerge(true);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && window.CloudSync && CloudSync.syncKey) CloudSync.pullAndMerge(true);
});
