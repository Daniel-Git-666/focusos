const CloudSync = {
  CONFIG_KEY: 'lsh_supabase_config_v1',
  client: null,
  user: null,
  channel: null,
  pushTimer: null,
  isApplyingRemote: false,

  getConfig() {
    try {
      return JSON.parse(localStorage.getItem(this.CONFIG_KEY) || '{}');
    } catch {
      return {};
    }
  },

  saveConfig(url, key) {
    localStorage.setItem(this.CONFIG_KEY, JSON.stringify({ url: url.trim(), key: key.trim() }));
  },

  async init() {
    const cfg = this.getConfig();
    if (!cfg.url || !cfg.key || !window.supabase) {
      this.updateUI();
      return false;
    }
    try {
      this.client = window.supabase.createClient(cfg.url, cfg.key);
      const { data } = await this.client.auth.getSession();
      this.user = data?.session?.user || null;
      if (this.user) {
        await this.pullAndMerge(true);
        this.subscribeRealtime();
      }
      this.updateUI();
      return Boolean(this.user);
    } catch (e) {
      console.warn('CloudSync init warning:', e);
      this.updateUI();
      return false;
    }
  },

  async signUp(email, password) {
    if (!this.client) return showToast('请先填写并保存 Supabase URL 和 Key');
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) return showToast('注册失败：' + error.message);
    this.user = data?.user || null;
    if (data?.session) {
      await this.pushNow();
      this.subscribeRealtime();
      this.updateUI();
      showToast('注册成功，已开启云端三端同步');
    } else {
      showToast('注册成功！请先前往邮箱点击确认链接，再回来点击登录');
    }
  },

  async signIn(email, password) {
    if (!this.client) return showToast('请先填写并保存 Supabase URL 和 Key');
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return showToast('登录失败：' + error.message);
    this.user = data.user;
    await this.pullAndMerge(false);
    this.subscribeRealtime();
    this.updateUI();
    showToast('已登录，云端同步已开启');
  },

  async signOut() {
    if (this.channel && this.client) this.client.removeChannel(this.channel);
    if (this.client) await this.client.auth.signOut();
    this.user = null;
    this.channel = null;
    this.updateUI();
    showToast('已退出云端账号（本地数据仍保留）');
  },

  schedulePush() {
    if (!this.client || !this.user || this.isApplyingRemote) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.pushNow(), 900);
  },

  async pushNow() {
    if (!this.client || !this.user) return;
    try {
      const { error } = await this.client.from('focusos_state').upsert({
        user_id: this.user.id,
        payload: appState,
        updated_at: appState.meta?.updatedAt || new Date().toISOString()
      });
      if (error) throw error;
      this.setDockStatus('synced');
    } catch (e) {
      console.warn('Cloud push error:', e);
      this.setDockStatus('local');
    }
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
        // First time cloud sync: upload current local state
        await this.pushNow();
        return;
      }

      const remote = data.payload;
      const remoteTime = new Date(remote.meta?.updatedAt || data.updated_at || 0).getTime();
      const localTime = new Date(appState.meta?.updatedAt || 0).getTime();

      if (remoteTime > localTime) {
        this.isApplyingRemote = true;
        appState = remote;
        StorageService.save(appState);
        renderApp();
        this.isApplyingRemote = false;
        if (!silent) showToast('已从云端拉取最新数据');
      } else if (localTime > remoteTime) {
        await this.pushNow();
      }
      this.setDockStatus('synced');
    } catch (e) {
      console.warn('Cloud pull error:', e);
      if (!silent) showToast('云端拉取失败：' + e.message);
    }
  },

  subscribeRealtime() {
    if (!this.client || !this.user) return;
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = this.client
      .channel('focusos-realtime')
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
          this.isApplyingRemote = true;
          appState = remote;
          StorageService.save(appState);
          renderApp();
          this.isApplyingRemote = false;
          this.setDockStatus('synced');
          showToast('其他设备已更新，已自动同步');
        }
      })
      .subscribe();
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
      statusBox.textContent = '当前为本地双层保存模式（登录后即可开启 Mac / iPad / iPhone 三端同步）';
      if (authForm) authForm.style.display = 'block';
      if (signedInBox) signedInBox.style.display = 'none';
    }
  }
};
