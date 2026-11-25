const CloudSync = {
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

  mergeHealthLogs(healthLogs = []) {
    if (!Array.isArray(healthLogs) || !healthLogs.length) return false;
    let changed = false;
    appState.sleepLogs = appState.sleepLogs || [];
    appState.activityLogs = appState.activityLogs || [];

    healthLogs.forEach(row => {
      const d = row.log_date;
      const hrs = Number(row.sleep_hours || 0);
      if (hrs > 0) {
        const existing = appState.sleepLogs.find(x => x.date === d);
        const nextBed = row.bedtime || '23:30';
        if (!existing || existing.duration !== Number(hrs.toFixed(1)) || existing.bedtime !== nextBed) {
          appState.sleepLogs = appState.sleepLogs.filter(x => x.date !== d);
          appState.sleepLogs.push({
            id: existing?.id || uid(), date: d, bedtime: nextBed,
            duration: Number(hrs.toFixed(1)), quality: 4, source: 'apple_watch'
          });
          changed = true;
        }
      }
      const km = Number(row.running_km || 0);
      const kcal = Number(row.active_kcal || 0);
      if (km > 0 || kcal > 0) {
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

  async testHealthIngest() {
    if (!this.client || !this.syncKey) return showToast('请先在上方设置并保存你的永久同步口令');
    const { error } = await this.client.rpc('ingest_apple_health_v2', {
      p_key: this.syncKey,
      p_date: todayISO(0),
      p_bedtime: '23:18',
      p_sleep_hours: 7.4,
      p_running_km: 3.6,
      p_active_kcal: 320
    });
    if (error) return showToast('测试失败：' + error.message);
    await this.pullAndMerge(true);
    showToast('模拟手表同步成功！已更新睡眠与跑步记录 ✓');
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
