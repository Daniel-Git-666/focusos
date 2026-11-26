var CloudSync = window.CloudSync = {
  KEY_STORAGE: 'lsh_sync_key_v3',
  COOKIE_NAME: 'focusos_sync_key',
  DEFAULT_URL: 'https://txkzzlcfeexfnwqeeuzr.supabase.co',
  DEFAULT_KEY: 'sb_publishable_mv-O0u202Z0EudTvYfhBVg_3l13CkPn',
  client: null,
  syncKey: '',
  pushTimer: null,
  pollTimer: null,
  isApplyingRemote: false,
  lastError: '',

  readCookie(name) {
    try {
      const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch { return ''; }
  },

  writeCookie(name, val) {
    try {
      document.cookie = `${name}=${encodeURIComponent(val)}; max-age=31536000; path=/; SameSite=Lax`;
    } catch {}
  },

  readKeyFromHash() {
    try {
      const hash = window.location.hash || '';
      const m = hash.match(/key=([^&]+)/);
      return m ? decodeURIComponent(m[1]).trim() : '';
    } catch { return ''; }
  },

  async loadStoredKey() {
    // Priority: URL #key= > localStorage > Cookie > IndexedDB
    const fromHash = this.readKeyFromHash();
    if (fromHash && fromHash.length >= 8) {
      await this.persistKey(fromHash);
      return fromHash;
    }
    try {
      const fromLS = (localStorage.getItem(this.KEY_STORAGE) || '').trim();
      if (fromLS.length >= 8) return fromLS;
    } catch {}
    const fromCookie = this.readCookie(this.COOKIE_NAME).trim();
    if (fromCookie.length >= 8) {
      try { localStorage.setItem(this.KEY_STORAGE, fromCookie); } catch {}
      return fromCookie;
    }
    if (StorageService.db) {
      const fromIDB = await new Promise((resolve) => {
        try {
          const tx = StorageService.db.transaction(StorageService.STORE_NAME, 'readonly');
          const req = tx.objectStore(StorageService.STORE_NAME).get('sync_key_v3');
          req.onsuccess = () => resolve(req.result ? req.result.value : '');
          req.onerror = () => resolve('');
        } catch { resolve(''); }
      });
      if (fromIDB && fromIDB.length >= 8) {
        try { localStorage.setItem(this.KEY_STORAGE, fromIDB); } catch {}
        this.writeCookie(this.COOKIE_NAME, fromIDB);
        return fromIDB;
      }
    }
    return '';
  },

  async persistKey(key) {
    const clean = (key || '').trim();
    this.syncKey = clean;
    try {
      if (clean) localStorage.setItem(this.KEY_STORAGE, clean);
      else localStorage.removeItem(this.KEY_STORAGE);
    } catch {}
    this.writeCookie(this.COOKIE_NAME, clean);
    if (StorageService.db) {
      try {
        const tx = StorageService.db.transaction(StorageService.STORE_NAME, 'readwrite');
        tx.objectStore(StorageService.STORE_NAME).put({ key: 'sync_key_v3', value: clean });
      } catch {}
    }
  },

  getMagicLink() {
    const base = window.location.origin + window.location.pathname;
    return this.syncKey ? `${base}#key=${encodeURIComponent(this.syncKey)}` : base;
  },

  generateRandomKey() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = 'focus-';
    for (let i = 0; i < 12; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  },

  async init() {
    this.lastError = '';
    if (!window.supabase) {
      this.lastError = '云同步组件加载失败，请检查网络';
      this.updateUI();
      return false;
    }
    this.client = window.supabase.createClient(this.DEFAULT_URL, this.DEFAULT_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    this.syncKey = await this.loadStoredKey();
    if (this.syncKey) {
      this.updateUI();
      await this.pullAndMerge(true);
      this.startPolling();
      return true;
    }
    this.updateUI();
    return false;
  },

  async activateKey(newKey) {
    const clean = (newKey || '').trim();
    if (clean.length < 8) return showToast('同步口令至少需要 8 位字符');
    await this.persistKey(clean);
    try { history.replaceState(null, '', this.getMagicLink()); } catch {}
    if (!this.client && window.supabase) {
      this.client = window.supabase.createClient(this.DEFAULT_URL, this.DEFAULT_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
    }
    this.updateUI();
    const ok = await this.pullAndMerge(false);
    if (ok) {
      this.startPolling();
      showToast('永久同步已开启，以后无需再登录 ✓');
    }
  },

  async disconnect() {
    clearInterval(this.pollTimer);
    await this.persistKey('');
    this.updateUI();
    showToast('已断开本设备云同步（本地数据仍保留）');
  },

  schedulePush() {
    if (!this.client || !this.syncKey || this.isApplyingRemote) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.pushNow(), 450);
  },

  async pushNow() {
    if (!this.client || !this.syncKey) return false;
    try {
      const ts = appState.meta?.updatedAt || new Date().toISOString();
      const { error } = await this.client.rpc('focusos_push', {
        p_key: this.syncKey,
        p_payload: appState,
        p_updated_at: ts
      });
      if (error) throw error;
      this.lastError = '';
      this.setDockStatus('synced');
      return true;
    } catch (e) {
      console.warn('Cloud push error:', e);
      this.lastError = e.message || '推送失败';
      this.setDockStatus('local');
      showToast('云端推送失败：' + this.lastError);
      return false;
    }
  },

  parseDateFlexible(str) {
    if (!str) return null;
    const s = String(str).trim();
    const direct = new Date(s);
    if (!isNaN(direct.getTime())) return direct;
    // Handle Chinese iOS Shortcuts date formats e.g. "2026年11月25日 23:25" or "2026/11/25 下午11:25"
    const m = s.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})日?\s*(上午|下午|AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/i);
    if (m) {
      let hr = parseInt(m[5], 10);
      const ampm = (m[4] || '').toUpperCase();
      if ((ampm === '下午' || ampm === 'PM') && hr < 12) hr += 12;
      if ((ampm === '上午' || ampm === 'AM') && hr === 12) hr = 0;
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), hr, parseInt(m[6], 10), parseInt(m[7] || '0', 10));
    }
    return null;
  },

  normalizeSleepStage(label) {
    const s = String(label || '').trim().toLowerCase();
    if (!s || s.includes('in bed') || s.includes('卧床')) return null;
    if (s.includes('awake') || s.includes('清醒')) return 'awake';
    if (s.includes('rem') || s.includes('快速动眼') || s.includes('眼动')) return 'rem';
    if (s.includes('deep') || s.includes('深度') || s.includes('深睡')) return 'deep';
    if (s.includes('core') || s.includes('核心') || s.includes('浅睡') || s.includes('asleep') || s.includes('睡眠')) return 'core';
    return null;
  },

  parseSleepRaw(rawText, logDate) {
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return null;
    const parts = (logDate || todayISO(0)).split('-').map(Number);
    if (parts.length !== 3) return null;
    // Window: previous day 20:00 to logDate 14:00 (user-specified)
    const winStart = new Date(parts[0], parts[1] - 1, parts[2] - 1, 20, 0, 0, 0).getTime();
    const winEnd = new Date(parts[0], parts[1] - 1, parts[2], 14, 0, 0, 0).getTime();

    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const seen = new Set();
    const segments = [];

    lines.forEach(line => {
      const cols = line.split('|').map(c => c.trim());
      if (cols.length < 3) return;
      const stage = this.normalizeSleepStage(cols[0]);
      if (!stage) return;
      const sd = this.parseDateFlexible(cols[1]);
      const ed = this.parseDateFlexible(cols[2]);
      if (!sd || !ed) return;
      const sMs = Math.max(sd.getTime(), winStart);
      const eMs = Math.min(ed.getTime(), winEnd);
      if (eMs <= sMs) return;
      const key = `${stage}_${sMs}_${eMs}`;
      if (seen.has(key)) return;
      seen.add(key);
      const fmt = (ms) => {
        const dt = new Date(ms);
        return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      };
      segments.push({
        stage,
        startMs: sMs,
        endMs: eMs,
        durMin: Math.round((eMs - sMs) / 60000),
        startLabel: fmt(sMs),
        endLabel: fmt(eMs)
      });
    });

    if (!segments.length) return null;
    segments.sort((a, b) => a.startMs - b.startMs);

    const asleepSegs = segments.filter(s => s.stage !== 'awake');
    if (!asleepSegs.length) return null;

    const deepMin = segments.filter(s => s.stage === 'deep').reduce((a, b) => a + b.durMin, 0);
    const coreMin = segments.filter(s => s.stage === 'core').reduce((a, b) => a + b.durMin, 0);
    const remMin = segments.filter(s => s.stage === 'rem').reduce((a, b) => a + b.durMin, 0);
    const awakeMin = segments.filter(s => s.stage === 'awake').reduce((a, b) => a + b.durMin, 0);
    const totalAsleepMin = deepMin + coreMin + remMin;
    if (totalAsleepMin <= 0) return null;

    return {
      bedtime: asleepSegs[0].startLabel,
      wakeTime: asleepSegs[asleepSegs.length - 1].endLabel,
      duration: Number((totalAsleepMin / 60).toFixed(1)),
      stages: { deepMin, coreMin, remMin, awakeMin, totalAsleepMin },
      segments
    };
  },

  mergeHealthLogs(healthLogs = []) {
    if (!Array.isArray(healthLogs) || !healthLogs.length) return false;
    let changed = false;
    appState.sleepLogs = appState.sleepLogs || [];
    appState.activityLogs = appState.activityLogs || [];
    const skipDemo = Boolean(appState.meta?.demoHealthCleared);

    healthLogs.forEach(row => {
      const d = row.log_date;
      const parsedStages = this.parseSleepRaw(row.sleep_raw, d);
      const hrs = parsedStages ? parsedStages.duration : Number(row.sleep_hours || 0);
      const nextBed = parsedStages ? parsedStages.bedtime : (row.bedtime || '23:30');
      const isSimulatedSleep = skipDemo && Number(hrs.toFixed(1)) === 7.4 && (nextBed === '23:18' || nextBed === '23:30') && !row.sleep_raw;
      const isSimulatedStages = skipDemo && typeof row.sleep_raw === 'string' && row.sleep_raw.includes('SIMULATED_FOCUSOS');

      if (hrs > 0 && !isSimulatedSleep && !isSimulatedStages) {
        const existing = appState.sleepLogs.find(x => x.date === d);
        const nextSegCount = parsedStages ? parsedStages.segments.length : 0;
        const oldSegCount = existing?.segments?.length || 0;
        if (!existing || existing.duration !== Number(hrs.toFixed(1)) || existing.bedtime !== nextBed || nextSegCount !== oldSegCount) {
          appState.sleepLogs = appState.sleepLogs.filter(x => x.date !== d);
          appState.sleepLogs.push({
            id: existing?.id || uid(),
            date: d,
            bedtime: nextBed,
            wakeTime: parsedStages ? parsedStages.wakeTime : (existing?.wakeTime || ''),
            duration: Number(hrs.toFixed(1)),
            quality: 4,
            source: 'apple_watch',
            stages: parsedStages ? parsedStages.stages : (existing?.stages || null),
            segments: parsedStages ? parsedStages.segments : (existing?.segments || null)
          });
          changed = true;
        }
      }
      const km = Number(row.running_km || 0);
      const kcal = Number(row.active_kcal || 0);
      const isSimulatedAct = skipDemo && Number(km.toFixed(2)) === 3.6 && Math.round(kcal) === 320;
      if ((km > 0 || kcal > 0) && !isSimulatedAct) {
        const existingAct = appState.activityLogs.find(x => x.date === d);
        if (!existingAct || existingAct.runningKm !== Number(km.toFixed(2)) || existingAct.activeKcal !== Math.round(kcal)) {
          appState.activityLogs = appState.activityLogs.filter(x => x.date !== d);
          appState.activityLogs.push({ date: d, runningKm: Number(km.toFixed(2)), activeKcal: Math.round(kcal) });
          changed = true;
        }
        if (km >= 1.5 || kcal >= 250) {
          const runHabit = (appState.habits || []).find(h => h.name.includes('跑步') || h.name.includes('有氧'));
          if (runHabit) {
            runHabit.logs = runHabit.logs || [];
            if (!runHabit.logs.includes(d)) { runHabit.logs.push(d); changed = true; }
          }
        }
      }
    });
    return changed;
  },

  async pullAndMerge(silent = false) {
    if (!this.client || !this.syncKey) return false;
    try {
      const { data, error } = await this.client.rpc('focusos_pull', { p_key: this.syncKey });
      if (error) throw error;
      this.lastError = '';

      if (!data || !data.found || !data.payload) {
        this.mergeHealthLogs(data?.health_logs || []);
        this.lastHealthLogs = data?.health_logs || [];
        this.renderHealthPreview();
        await this.pushNow();
        renderApp();
        return true;
      }

      const remote = data.payload;
      const remoteTs = remote.meta?.updatedAt || data.updated_at || '2020-01-01T00:00:00.000Z';
      const remoteTime = new Date(remoteTs).getTime();
      const localTime = new Date(appState.meta?.updatedAt || 0).getTime();
      const localIsSeed = Boolean(appState.meta?.isSeed);

      let updatedUI = false;
      if (localIsSeed || remoteTime > localTime) {
        this.isApplyingRemote = true;
        appState = remote;
        StorageService.save(appState, true);
        this.isApplyingRemote = false;
        updatedUI = true;
        if (!silent) showToast('已从云端同步最新数据 ✓');
      } else if (localTime > remoteTime) {
        await this.pushNow();
      }

      if (this.mergeHealthLogs(data.health_logs || [])) {
        StorageService.save(appState);
        await this.pushNow();
        updatedUI = true;
      }

      this.lastHealthLogs = data.health_logs || [];
      this.renderHealthPreview();
      if (updatedUI) renderApp();
      this.setDockStatus('synced');
      return true;
    } catch (e) {
      console.warn('Cloud pull error:', e);
      this.lastError = e.message || '拉取失败';
      this.updateUI();
      if (!silent) showToast('同步失败：' + this.lastError);
      return false;
    }
  },

  async clearDemoHealthData() {
    appState.meta = appState.meta || {};
    appState.meta.demoHealthCleared = true;
    appState.sleepLogs = (appState.sleepLogs || []).filter(x =>
      x.source === 'apple_watch' && !(Number(x.duration) === 7.4 && (x.bedtime === '23:18' || x.bedtime === '23:30'))
    );
    appState.activityLogs = (appState.activityLogs || []).filter(x => !(Number(x.runningKm) === 3.6 && Math.round(Number(x.activeKcal)) === 320));
    this.mergeHealthLogs(this.lastHealthLogs || []);
    StorageService.save(appState);
    await this.pushNow();
    renderApp();
    this.renderHealthPreview();
    showToast('已清除演示睡眠与测试数据，现仅展示真实记录 ✓');
  },

  mergeImportData(incoming) {
    if (!incoming || typeof incoming !== 'object') return 0;
    let added = 0;
    const mergeByKey = (targetArr, srcArr, keyFn) => {
      if (!Array.isArray(srcArr)) return targetArr;
      const existingKeys = new Set((targetArr || []).map(keyFn));
      srcArr.forEach(item => {
        const k = keyFn(item);
        if (!existingKeys.has(k)) {
          targetArr.push({ ...item, id: item.id || uid(), updatedAt: new Date().toISOString() });
          existingKeys.add(k);
          added++;
        }
      });
      return targetArr;
    };
    appState.tasks = mergeByKey(appState.tasks || [], incoming.tasks, x => (x.title || '').trim());
    appState.sprints = mergeByKey(appState.sprints || [], incoming.sprints, x => `${x.date}_${(x.title || '').trim()}`);
    appState.meds = mergeByKey(appState.meds || [], incoming.meds, x => (x.name || '').trim());
    appState.habits = mergeByKey(appState.habits || [], incoming.habits, x => (x.name || '').trim());
    appState.anniversaries = mergeByKey(appState.anniversaries || [], incoming.anniversaries, x => (x.title || '').trim());
    appState.notes = mergeByKey(appState.notes || [], incoming.notes, x => (x.content || '').trim().slice(0, 60));
    appState.bookmarks = mergeByKey(appState.bookmarks || [], incoming.bookmarks, x => (x.url || '').trim());
    appState.sleepLogs = mergeByKey(appState.sleepLogs || [], incoming.sleepLogs, x => x.date);
    appState.activityLogs = mergeByKey(appState.activityLogs || [], incoming.activityLogs, x => x.date);
    return added;
  },

  renderHealthPreview() {
    const box = document.getElementById('aw-preview-box');
    if (!box) return;
    const logs = (this.lastHealthLogs || []).slice(-5).reverse();
    if (!logs.length) {
      box.textContent = '云端暂未收到手表记录（运行 iPhone 快捷指令后会自动显示在这里）';
      return;
    }
    box.innerHTML = logs.map(r => {
      const parsed = this.parseSleepRaw(r.sleep_raw, r.log_date);
      const sleepStr = parsed
        ? `睡眠 ${parsed.duration.toFixed(1)}h (${parsed.bedtime}→${parsed.wakeTime} · 深${parsed.stages.deepMin}m/核${parsed.stages.coreMin}m/REM${parsed.stages.remMin}m)`
        : `睡眠 ${Number(r.sleep_hours || 0).toFixed(1)}h (${r.bedtime || '--'})`;
      return `<div>${r.log_date} · ${sleepStr} · 跑步 ${Number(r.running_km || 0).toFixed(2)} km · ${Math.round(r.active_kcal || 0)} kcal</div>`;
    }).join('');
  },

  async testHealthIngest() {
    if (!this.client || !this.syncKey) return showToast('请先在上方设置并保存你的永久同步口令');
    if (appState.meta) appState.meta.demoHealthCleared = false;
    const yest = todayISO(-1);
    const tod = todayISO(0);
    const sampleRaw = [
      `核心睡眠|${yest}T23:18:00+08:00|${tod}T00:05:00+08:00`,
      `深度睡眠|${tod}T00:05:00+08:00|${tod}T01:02:00+08:00`,
      `核心睡眠|${tod}T01:02:00+08:00|${tod}T02:15:00+08:00`,
      `快速动眼|${tod}T02:15:00+08:00|${tod}T03:00:00+08:00`,
      `清醒|${tod}T03:00:00+08:00|${tod}T03:10:00+08:00`,
      `核心睡眠|${tod}T03:10:00+08:00|${tod}T04:20:00+08:00`,
      `深度睡眠|${tod}T04:20:00+08:00|${tod}T04:55:00+08:00`,
      `核心睡眠|${tod}T04:55:00+08:00|${tod}T05:55:00+08:00`,
      `快速动眼|${tod}T05:55:00+08:00|${tod}T06:52:00+08:00`,
      `#SIMULATED_FOCUSOS`
    ].join('\n');
    const { error } = await this.client.rpc('ingest_apple_health_v2', {
      p_key: this.syncKey,
      p_date: tod,
      p_bedtime: '23:18',
      p_sleep_hours: 7.4,
      p_running_km: 3.6,
      p_active_kcal: 320,
      p_sleep_raw: sampleRaw
    });
    if (error) return showToast('测试失败：' + error.message);
    await this.pullAndMerge(true);
    showToast('模拟手表同步成功！已更新睡眠阶段与跑步记录 ✓');
  },

  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.syncKey && !this.isApplyingRemote) {
        this.pullAndMerge(true);
      }
    }, 8000);
  },

  setDockStatus(mode) {
    const dot = document.getElementById('saveStatusDot');
    const txt = document.getElementById('saveStatusText');
    if (!dot || !txt) return;
    dot.classList.remove('saving');
    if (mode === 'synced' && this.syncKey) {
      txt.textContent = `云端已同步 ${formatTimeHMS().slice(0, 5)}`;
    } else {
      txt.textContent = `本地已保存 ${formatTimeHMS().slice(0, 5)}`;
    }
  },

  updateUI() {
    const statusBox = document.getElementById('cloudAuthStatus');
    const keyInput = document.getElementById('sync-key-input');
    const connectedActions = document.getElementById('cloudConnectedActions');
    const endpointInput = document.getElementById('aw-endpoint');
    const tokenInput = document.getElementById('aw-token');

    if (endpointInput) endpointInput.value = `${this.DEFAULT_URL}/rest/v1/rpc/ingest_apple_health_v2`;
    if (tokenInput) tokenInput.value = this.syncKey || '请先在上方设置永久同步口令';
    if (keyInput && !keyInput.value && this.syncKey) keyInput.value = this.syncKey;
    if (!statusBox) return;

    if (this.syncKey) {
      statusBox.textContent = this.lastError
        ? `同步异常（${this.lastError}）— 请确认已在 Supabase 运行新的 SQL 脚本`
        : '永久同步已开启（永不过期、不掉线 · 三端复用同一口令）';
      if (connectedActions) connectedActions.style.display = 'flex';
      this.setDockStatus('synced');
    } else {
      statusBox.textContent = '设置一个专属同步口令（至少 8 位），三端一次绑定永久免登录';
      if (connectedActions) connectedActions.style.display = 'none';
    }
  }
};
