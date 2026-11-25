const CloudSync = {
  CONFIG_KEY: 'lsh_supabase_config_v1',
  SESSION_KEY: 'lsh_supabase_session_v1',
  DEFAULT_URL: 'https://txkzzlcfeexfnwqeeuzr.supabase.co',
  DEFAULT_KEY: 'sb_publishable_mv-O0u202Z0EudTvYfhBVg_3l13CkPn',
  client: null,
  user: null,
  channel: null,
  pushTimer: null,
  pollTimer: null,
  isApplyingRemote: false,
  lastError: '',

  getConfig() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.CONFIG_KEY) || '{}');
      return {
        url: saved.url || this.DEFAULT_URL,
        key: saved.key || this.DEFAULT_KEY,
        email: saved.email || ''
      };
    } catch {
      return { url: this.DEFAULT_URL, key: this.DEFAULT_KEY, email: '' };
    }
  },

  saveConfig(url, key, email = '') {
    const prev = this.getConfig();
    localStorage.setItem(this.CONFIG_KEY, JSON.stringify({
      url: (url !== undefined ? url : prev.url || '').trim(),
      key: (key !== undefined ? key : prev.key || '').trim(),
      email: (email || prev.email || '').trim()
    }));
  },

  saveSessionTokens(session) {
    if (!session || !session.refresh_token) return;
    try {
      localStorage.setItem(this.SESSION_KEY, JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        email: session.user?.email || ''
      }));
      if (session.user?.email) this.saveConfig(undefined, undefined, session.user.email);
    } catch {}
  },

  clearSessionTokens() {
    try { localStorage.removeItem(this.SESSION_KEY); } catch {}
  },

  createSupabaseClient(url, key) {
    return window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: 'focusos_sb_auth_v1',
        storage: window.localStorage
      }
    });
  },

  async init() {
    this.lastError = '';
    const cfg = this.getConfig();
    if (!window.supabase) {
      this.lastError = '云同步组件加载失败，请检查网络后刷新';
      this.updateUI();
      return false;
    }
    if (!cfg.url || !cfg.key) {
      this.updateUI();
      return false;
    }

    try {
      this.client = this.createSupabaseClient(cfg.url, cfg.key);
      this.client.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          this.user = session.user;
          this.saveSessionTokens(session);
          this.updateUI();
        } else if (event === 'SIGNED_OUT') {
          this.user = null;
          this.clearSessionTokens();
          this.updateUI();
        }
      });

      const { data, error } = await this.client.auth.getSession();
      if (error) this.lastError = error.message;
      let session = data?.session || null;

      // Fallback: restore from backup tokens if Supabase localStorage key was missed
      if (!session) {
        try {
          const raw = localStorage.getItem(this.SESSION_KEY);
          if (raw) {
            const tokens = JSON.parse(raw);
            if (tokens.refresh_token) {
              const res = await this.client.auth.setSession({
                access_token: tokens.access_token || '',
                refresh_token: tokens.refresh_token
              });
              session = res?.data?.session || null;
              if (session) this.saveSessionTokens(session);
            }
          }
        } catch {}
      }

      this.user = session?.user || null;
      if (this.user) {
        this.saveSessionTokens(session);
        this.updateUI();
        await this.pullAndMerge(true);
        this.subscribeRealtime();
        this.startPolling();
      } else {
        this.updateUI();
      }
      return Boolean(this.user);
    } catch (e) {
      console.warn('CloudSync init warning:', e);
      this.lastError = e.message || '初始化失败';
      this.updateUI();
      return false;
    }
  },

  async signUp(email, password) {
    if (!this.client) return showToast('请先填写并保存 Supabase URL 和 Key');
    this.saveConfig(undefined, undefined, email);
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) return showToast('注册失败：' + error.message);
    this.user = data?.user || null;
    if (data?.session) {
      this.saveSessionTokens(data.session);
      await this.pullAndMerge(true);
      this.subscribeRealtime();
      this.startPolling();
      this.updateUI();
      showToast('注册成功，已开启云端三端同步');
    } else {
      showToast('注册成功！请先前往邮箱点击确认链接，再回来点击登录');
    }
  },

  async signIn(email, password) {
    if (!this.client) return showToast('请先填写并保存 Supabase URL 和 Key');
    this.saveConfig(undefined, undefined, email);
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return showToast('登录失败：' + error.message);
    this.user = data.user;
    this.saveSessionTokens(data.session);
    this.updateUI();
    await this.pullAndMerge(false);
    this.subscribeRealtime();
    this.startPolling();
    showToast('已登录，云端同步已开启');
  },

  async signOut() {
    if (this.channel && this.client) this.client.removeChannel(this.channel);
    clearInterval(this.pollTimer);
    if (this.client) await this.client.auth.signOut();
    this.user = null;
    this.channel = null;
    this.clearSessionTokens();
    this.updateUI();
    showToast('已退出云端账号（本地数据仍保留）');
  },

  schedulePush() {
    if (!this.client || !this.user || this.isApplyingRemote) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.pushNow(), 450);
  },

  async pushNow() {
    if (!this.client || !this.user) return;
    try {
      const ts = appState.meta?.updatedAt || new Date().toISOString();
      const { error } = await this.client
        .from('focusos_state')
        .upsert(
          { user_id: this.user.id, payload: appState, updated_at: ts },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
      this.setDockStatus('synced');
    } catch (e) {
      console.warn('Cloud push error:', e);
      this.setDockStatus('local');
      showToast('云端推送失败：' + (e.message || '请检查网络'));
    }
  },

  applyRemote(remote) {
    this.isApplyingRemote = true;
    appState = remote;
    StorageService.save(appState, true);
    renderApp();
    this.isApplyingRemote = false;
    this.setDockStatus('synced');
  },

  async pullAndMerge(silent = false) {
    if (!this.client || !this.user) return;
    try {
      const { data, error } = await this.client
        .from('focusos_state')
        .select('payload, updated_at')
        .eq('user_id', this.user.id)
        .maybeSingle();
      if (error) throw error;

      if (!data || !data.payload) {
        await this.pushNow();
        return;
      }

      const remote = data.payload;
      const remoteTs = remote.meta?.updatedAt || data.updated_at || '2020-01-01T00:00:00.000Z';
      const remoteTime = new Date(remoteTs).getTime();
      const localTime = new Date(appState.meta?.updatedAt || 0).getTime();
      const localIsSeed = Boolean(appState.meta?.isSeed);

      if (localIsSeed || remoteTime > localTime) {
        this.applyRemote(remote);
        if (!silent) showToast('已从云端拉取最新数据');
      } else if (localTime > remoteTime) {
        await this.pushNow();
      } else {
        this.setDockStatus('synced');
      }
    } catch (e) {
      console.warn('Cloud pull error:', e);
      if (!silent) showToast('云端拉取失败：' + e.message);
    }
  },

  subscribeRealtime() {
    if (!this.client || !this.user) return;
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = this.client
      .channel('focusos-realtime-' + this.user.id.slice(0, 8))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'focusos_state',
        filter: `user_id=eq.${this.user.id}`
      }, (payload) => {
        const remote = payload.new?.payload;
        if (!remote) return;
        const remoteTime = new Date(remote.meta?.updatedAt || 0).getTime();
        const localTime = new Date(appState.meta?.updatedAt || 0).getTime();
        if (remoteTime > localTime) {
          this.applyRemote(remote);
          showToast('其他设备已更新，已同步 ✓');
        }
      })
      .subscribe();
  },

  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && this.user && !this.isApplyingRemote) {
        this.pullAndMerge(true);
      }
    }, 10000);
  },

  setDockStatus(mode) {
    const dot = document.getElementById('saveStatusDot');
    const txt = document.getElementById('saveStatusText');
    if (!dot || !txt) return;
    dot.classList.remove('saving');
    if (mode === 'synced' && this.user) {
      txt.textContent = `云端已同步 ${formatTimeHMS().slice(0, 5)}`;
    } else {
      txt.textContent = `本地已保存 ${formatTimeHMS().slice(0, 5)}`;
    }
  },

  updateUI() {
    const statusBox = document.getElementById('cloudAuthStatus');
    const authForm = document.getElementById('cloudAuthForm');
    const signedInBox = document.getElementById('cloudSignedInBox');
    if (!statusBox) return;

    if (this.user) {
      statusBox.textContent = `已连接云端账号：${this.user.email}（三端实时同步开启）`;
      if (authForm) authForm.style.display = 'none';
      if (signedInBox) signedInBox.style.display = 'flex';
      this.setDockStatus('synced');
    } else {
      statusBox.textContent = this.lastError
        ? `云端未连接（${this.lastError}）`
        : '当前为本地双层保存模式（登录后即可开启 Mac / iPad / iPhone 三端同步）';
      if (authForm) authForm.style.display = 'block';
      if (signedInBox) signedInBox.style.display = 'none';
    }
  }
};
