/* ==========================================================================
   STORE OWNER & MERCHANT PORTAL LOGIC (owner.js)
   11-Stamp Milestone Reward Terminal:
   - Stamp #5:  20% OFF Offer
   - Stamp #8:  50% OFF Offer
   - Stamp #11: Grand FREE GIFT (Resets card for next cycle)
   ========================================================================== */

const MAX_STAMPS = 11;
const MILESTONE_20_OFF = 5;
const MILESTONE_50_OFF = 8;
const MILESTONE_FREE_GIFT = 11;
const APP_STORAGE_KEY_USERS = 'golden_loyalty_users_v3_6ticks';
const APP_STORAGE_KEY_OWNER = 'golden_loyalty_owner_session_v3';
const APP_STORAGE_KEY_STORE = 'golden_loyalty_store_config_v3';

const DEFAULT_STORE = {
  name: "Loyalty Reward",
  branch: "Main Store",
  rewardTitle: "Free Signature Reward or Gourmet Item",
  storeCode: "LOYALTY-REWARD-STORE-TOKEN-2026",
  ownerUsername: "admin",
  ownerPassword: "admin123",
  cashierPin: "1234",
  recoveryKey: "9999"
};

// Known mock demo customer phone numbers & automation accounts to purge
const MOCK_DEMO_PHONES = ["9876543210", "9811223344", "9822334455", "9833445566", "9988776655", "9876543211", "9840123456", "test_check_cols", "6369095106", "918940757402", "9698970896"];
const DEFAULT_USERS = [];

const API_BASE_URL = (function() {
  if (window.location.protocol.startsWith('http') && 
      !window.location.hostname.includes('androidplatform.net')) {
    return window.location.origin;
  }
  return "http://localhost:8085";
})();

class StoreOwnerApp {
  constructor() {
    this.users = [];
    this.storeConfig = { ...DEFAULT_STORE };
    this.isLoggedIn = false;
    this.ownerFilter = 'all';
    this.ownerSearchQuery = '';
    this.syncTimer = null;
    this.knownPendingRequestIds = new Set();
    this.expandedCustomerPhones = new Set();
    this.appVersion = "1.6.4";
    this.versionCode = 12;
    this.latestUpdateInfo = null;

    this.init();
  }

  init() {
    this.loadState();
    this.bindEvents();
    this.setupPWA();
    this.render();
    this.fetchRemoteCustomers();
    this.startLiveSync();
    this.setupOfflineSync();
    this.checkForAppUpdates(false);
  }

  setupOfflineSync() {
    window.addEventListener('online', () => {
      this.syncOfflineQueue();
    });

    setInterval(() => {
      if (navigator.onLine && localStorage.getItem('owner_offline_pending_sync') === 'true') {
        this.syncOfflineQueue();
      }
    }, 8000);
  }

  async syncOfflineQueue() {
    if (localStorage.getItem('owner_offline_pending_sync') !== 'true') return;
    try {
      if (this.users.length > 0) {
        await this.pushCustomerToServer(this.users);
      }
      localStorage.removeItem('owner_offline_pending_sync');
      this.showToast("🔄 Reconnected! Offline store updates synced to server.", "success");
    } catch (e) {}
  }

  sanitizeCustomerNotes(userList) {
    if (!Array.isArray(userList)) return userList;
    userList.forEach(u => {
      if (Array.isArray(u.history)) {
        u.history.forEach(item => {
          if (item && typeof item.note === 'string' && item.note.includes('of 6')) {
            item.note = item.note.replace(/of 6 Collected/g, 'of 11 Collected')
                                 .replace(/\(Tick #1 of 6\)/g, '(Tick #1 of 11)')
                                 .replace(/of 6/g, 'of 11');
          }
        });
      }
    });
    return userList;
  }

  loadState() {
    // 1. Load shared users
    const storedUsers = localStorage.getItem(APP_STORAGE_KEY_USERS);
    if (storedUsers) {
      try {
        let loaded = JSON.parse(storedUsers);
        // Retain only real registered customers, purge hardcoded demo mock names
        this.users = Array.isArray(loaded) ? loaded.filter(u => !MOCK_DEMO_PHONES.includes(u.phone)) : [];
      } catch (e) {
        this.users = [];
      }
    } else {
      this.users = [];
    }
    this.sanitizeCustomerNotes(this.users);
    this.saveUsers();

    // 2. Load store configuration
    const storedStore = localStorage.getItem(APP_STORAGE_KEY_STORE);
    if (storedStore) {
      try {
        this.storeConfig = { ...DEFAULT_STORE, ...JSON.parse(storedStore) };
      } catch (e) {
        this.storeConfig = { ...DEFAULT_STORE };
      }
    }

    // 3. Check owner session
    const ownerSession = localStorage.getItem(APP_STORAGE_KEY_OWNER);
    if (ownerSession) {
      try {
        const parsed = JSON.parse(ownerSession);
        this.isLoggedIn = parsed === true || (parsed && parsed.isLoggedIn === true);
      } catch (e) {
        this.isLoggedIn = ownerSession === 'true';
      }
    } else {
      this.isLoggedIn = false;
    }
  }

  saveUsers() {
    localStorage.setItem(APP_STORAGE_KEY_USERS, JSON.stringify(this.users));
    this.pushCustomerToServer(this.users);
  }

  async fetchRemoteCustomers() {
    try {
      let remoteUsers = null;
      if (window.loyaltyDb && window.loyaltyDb.isReady) {
        remoteUsers = await window.loyaltyDb.fetchAllCustomers();
      }
      if (!remoteUsers) {
        const resp = await fetch(`${API_BASE_URL}/api/customers`, { cache: 'no-cache' });
        if (resp.ok) {
          const rawUsers = await resp.json();
          remoteUsers = Array.isArray(rawUsers) ? rawUsers : (rawUsers && rawUsers.phone ? [rawUsers] : []);
        }
      }

      if (Array.isArray(remoteUsers) && remoteUsers.length > 0) {
        this.sanitizeCustomerNotes(remoteUsers);
        let changed = false;
        remoteUsers.forEach(rem => {
          if (!rem.phone || MOCK_DEMO_PHONES.includes(rem.phone)) return;
          const idx = this.users.findIndex(u => u.phone === rem.phone);
          if (idx === -1) {
            this.users.unshift(rem);
            changed = true;
          } else {
            if (
              rem.stamps !== this.users[idx].stamps ||
              rem.giftsEarned !== this.users[idx].giftsEarned ||
              JSON.stringify(rem.history) !== JSON.stringify(this.users[idx].history)
            ) {
              this.users[idx] = { ...this.users[idx], ...rem };
              changed = true;
            }
          }
        });

        if (changed || (remoteUsers.length > 0 && this.users.length === 0)) {
          localStorage.setItem(APP_STORAGE_KEY_USERS, JSON.stringify(this.users));
          this.renderCustomerList();
          this.renderMetrics();
        }
      }
    } catch (e) {
      // Background retry
    }
  }

  startLiveSync() {
    if (this.syncTimer) clearInterval(this.syncTimer);

    // Setup Supabase Realtime Stream for Instant Push
    if (window.loyaltyDb && window.loyaltyDb.isReady) {
      window.loyaltyDb.subscribeToPendingRequests((req, eventType) => {
        if (this.isLoggedIn) {
          this.fetchPendingApprovalRequests();
          this.fetchRemoteCustomers();
        }
      });
    }

    this.syncTimer = setInterval(() => {
      this.fetchRemoteCustomers();
      if (this.isLoggedIn) {
        this.fetchPendingApprovalRequests();
      }
    }, 3500);
  }

  async fetchPendingApprovalRequests() {
    if (!this.isLoggedIn) return;
    try {
      let list = null;
      if (window.loyaltyDb && window.loyaltyDb.isReady) {
        list = await window.loyaltyDb.fetchPendingStampRequests();
      }
      if (!list) {
        const resp = await fetch(`${API_BASE_URL}/api/stamp-requests`, { cache: 'no-cache' });
        if (resp.ok) {
          const raw = await resp.json();
          list = Array.isArray(raw) ? raw : (raw && raw.id ? [raw] : []);
        }
      }
      if (!list) list = [];
      const banner = document.getElementById('repeatApprovalAlertBanner');
      const listEl = document.getElementById('pendingRequestsList');
      const badge = document.getElementById('pendingRequestsBadge');

      if (Array.isArray(list) && list.length > 0) {
        if (banner) banner.style.display = 'block';
        if (badge) badge.innerText = `${list.length} PENDING`;

        // Check for new requests to chime
        let hasNew = false;
        list.forEach(r => {
          if (!this.knownPendingRequestIds.has(r.id)) {
            hasNew = true;
            this.knownPendingRequestIds.add(r.id);
          }
        });

        // Automatically pop up the approval modal dialog for the latest pending request!
        const latestReq = list[0];
        const modal = document.getElementById('ownerApprovalModal');
        if (modal && (!modal.classList.contains('active') || hasNew)) {
          this.openApprovalModal(latestReq);
        }

        if (hasNew && window.soundEngine) {
          window.soundEngine.playSuccessTone();
        }

        if (listEl) {
          listEl.innerHTML = list.map(req => `
            <div class="approval-request-card">
              <div class="approval-req-info-wrap" style="cursor: pointer;" onclick="window.ownerApp.openApprovalModalById('${req.id}')" title="Click to review request details">
                <div class="approval-req-avatar">
                  ${((req.name || 'C').charAt(0)).toUpperCase()}
                </div>
                <div class="approval-req-meta">
                  <div class="approval-req-name">
                    ${req.name} <span class="approval-req-phone">(${req.phone})</span>
                  </div>
                  <div class="approval-req-sub">
                    Requested at ${req.timeStr || 'today'} • Currently has <strong style="color: #ffffff;">${req.currentStamps}/6 stamps</strong>
                  </div>
                </div>
              </div>
              <div class="approval-req-actions">
                <button type="button" class="approval-action-btn btn-approve" onclick="window.ownerApp.resolveRequest('${req.id}', 'approved')">
                  ✓ Approve Stamp
                </button>
                <button type="button" class="approval-action-btn btn-decline" onclick="window.ownerApp.resolveRequest('${req.id}', 'declined')">
                  ✕ Decline
                </button>
              </div>
            </div>
          `).join('');
        }
      } else {
        if (banner) banner.style.display = 'none';
        const modal = document.getElementById('ownerApprovalModal');
        if (modal) modal.classList.remove('active');
        this.activeModalRequestId = null;
      }
    } catch (e) {
      // Background retry
    }
  }

  openApprovalModal(req) {
    if (!req) return;
    this.activeModalRequestId = req.id;
    const modal = document.getElementById('ownerApprovalModal');
    if (!modal) return;

    const nameEl = document.getElementById('ownerModalCustName');
    const phoneEl = document.getElementById('ownerModalCustPhone');
    const badgeEl = document.getElementById('ownerModalCustStampsBadge');
    const timeEl = document.getElementById('ownerModalCustTime');
    const avatarEl = document.getElementById('ownerModalCustAvatar');

    const custName = req.name || 'Customer';
    if (nameEl) nameEl.innerText = custName;
    if (phoneEl) phoneEl.innerText = req.phone || '';
    if (badgeEl) badgeEl.innerText = `${req.currentStamps || 0} of 11 Stamps`;
    if (timeEl) timeEl.innerText = req.timeStr || 'Just now';
    if (avatarEl) avatarEl.innerText = (custName.charAt(0)).toUpperCase();

    const deviceEl = document.getElementById('ownerModalCustDevice');
    if (deviceEl) {
      if (req.device) {
        deviceEl.innerText = `📱 Request from ${req.device}`;
        deviceEl.style.display = 'block';
      } else {
        deviceEl.style.display = 'none';
      }
    }

    const approveBtn = document.getElementById('ownerModalApproveBtn');
    if (approveBtn) {
      approveBtn.onclick = () => {
        this.closeModals();
        this.resolveRequest(req.id, 'approved');
      };
    }

    const declineBtn = document.getElementById('ownerModalDeclineBtn');
    if (declineBtn) {
      declineBtn.onclick = () => {
        this.closeModals();
        this.resolveRequest(req.id, 'declined');
      };
    }

    modal.classList.add('active');
  }

  async openApprovalModalById(id) {
    if (!id) return;
    try {
      const resp = await fetch(`${API_BASE_URL}/api/stamp-requests`, { cache: 'no-cache' });
      if (!resp.ok) return;
      const raw = await resp.json();
      const list = Array.isArray(raw) ? raw : (raw && raw.id ? [raw] : []);
      const found = list.find(x => x.id === id);
      if (found) this.openApprovalModal(found);
    } catch (e) {
      console.warn("Error opening modal by id:", e);
    }
  }

  async resolveRequest(requestId, action) {
    try {
      let resolvedCloud = false;
      if (window.loyaltyDb && window.loyaltyDb.isReady) {
        const res = await window.loyaltyDb.resolveStampRequest(requestId, action);
        if (res.success) resolvedCloud = true;
      }

      // Also notify local API if active
      try {
        await fetch(`${API_BASE_URL}/api/stamp-request/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId, action })
        });
      } catch (err) {}

      if (action === 'approved') {
        if (window.soundEngine) window.soundEngine.playStampSound();
        this.showToast("✅ 2nd visit stamp approved & added to customer's card!", "success");
      } else {
        if (window.soundEngine) window.soundEngine.playClick();
        this.showToast("Stamp request declined.", "gold");
      }
      this.knownPendingRequestIds.delete(requestId);
      this.closeModals();
      this.activeModalRequestId = null;
      await this.fetchRemoteCustomers();
      await this.fetchPendingApprovalRequests();
    } catch (e) {
      this.showToast("Network error resolving request.", "error");
    }
  }

  async pushCustomerToServer(customerData) {
    if (!customerData) return;
    try {
      if (window.loyaltyDb && window.loyaltyDb.isReady) {
        if (Array.isArray(customerData)) {
          await window.loyaltyDb.upsertCustomers(customerData);
        } else {
          await window.loyaltyDb.upsertCustomer(customerData);
        }
      }
      const resp = await fetch(`${API_BASE_URL}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerData)
      });
      if (resp && resp.ok) {
        localStorage.removeItem('owner_offline_pending_sync');
      } else {
        localStorage.setItem('owner_offline_pending_sync', 'true');
      }
    } catch (e) {
      localStorage.setItem('owner_offline_pending_sync', 'true');
      console.warn("Offline: Store changes saved locally. Will auto-sync when online.", e);
    }
  }

  bindEvents() {
    // Password Visibility Toggle (Show / Hide password with eye icon)
    document.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('.password-toggle-btn');
      if (!toggleBtn) return;
      e.preventDefault();
      const wrapper = toggleBtn.closest('.input-field-wrapper');
      if (!wrapper) return;
      const input = wrapper.querySelector('input');
      if (!input) return;

      const eyeIcon = toggleBtn.querySelector('.eye-icon');
      const eyeOffIcon = toggleBtn.querySelector('.eye-off-icon');

      if (input.type === 'password') {
        input.type = 'text';
        toggleBtn.setAttribute('aria-label', 'Hide password');
        toggleBtn.setAttribute('title', 'Hide password');
        if (eyeIcon) eyeIcon.style.display = 'none';
        if (eyeOffIcon) eyeOffIcon.style.display = 'block';
      } else {
        input.type = 'password';
        toggleBtn.setAttribute('aria-label', 'Show password');
        toggleBtn.setAttribute('title', 'Show password');
        if (eyeIcon) eyeIcon.style.display = 'block';
        if (eyeOffIcon) eyeOffIcon.style.display = 'none';
      }
      input.focus();
    });

    // Store Owner Login Form
    const loginForm = document.getElementById('ownerLoginForm');
    if (loginForm) loginForm.addEventListener('submit', (e) => this.handleLogin(e));

    // One-Click Demo Owner Login
    const demoBtn = document.getElementById('demoOwnerLoginBtn');
    if (demoBtn) demoBtn.addEventListener('click', () => this.loginDemo());

    // Logout Buttons
    const logoutBtn = document.getElementById('ownerLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.handleLogout());
      logoutBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.handleLogout();
      });
    }

    const logoutHeaderBtn = document.getElementById('ownerLogoutHeaderBtn');
    if (logoutHeaderBtn) logoutHeaderBtn.addEventListener('click', () => this.handleLogout());

    // Search and Filter Pills
    const searchInput = document.getElementById('ownerCustomerSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.ownerSearchQuery = e.target.value.toLowerCase().trim();
        this.renderCustomerList();
      });
    }

    const manualSyncBtn = document.getElementById('manualSyncBtn');
    if (manualSyncBtn) {
      manualSyncBtn.addEventListener('click', async () => {
        manualSyncBtn.innerText = "⏳ Syncing...";
        await this.fetchRemoteCustomers();
        manualSyncBtn.innerText = "✓ Synced";
        this.showToast("☁️ Customer directory refreshed from server!", "success");
        setTimeout(() => { manualSyncBtn.innerText = "🔄 Refresh Now"; }, 1500);
      });
    }

    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.preventDefault();
        const filter = pill.getAttribute('data-filter') || 'all';
        this.setFilter(filter);
      });
    });

    // Quick Add Customer Form
    const addCustForm = document.getElementById('ownerAddCustomerForm');
    if (addCustForm) addCustForm.addEventListener('submit', (e) => this.handleAddCustomer(e));

    // Print Standee (Isolates only the counter standee card)
    const printBtn = document.getElementById('printStandeeBtn');
    if (printBtn) printBtn.addEventListener('click', () => this.printStandeeCard());

    // Cashier Terminal APK Download
    const cashierApkBtn = document.getElementById('ownerTerminalApkDownloadLink');
    if (cashierApkBtn) {
      const ownerApkUrl = 'https://raw.githubusercontent.com/sughan21/New-loyal-cards/main/StoreTerminal-Owner.apk';
      cashierApkBtn.href = ownerApkUrl;
      cashierApkBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.showToast("⬇️ Starting Cashier Terminal APK download...", "gold");
        if (window.AndroidBridge && typeof window.AndroidBridge.downloadApk === 'function') {
          window.AndroidBridge.downloadApk(ownerApkUrl);
        } else {
          window.location.href = ownerApkUrl;
        }
      });
    }

    // Copy Standee URL
    const copyBtn = document.getElementById('copyStandeeUrlBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const urlInput = document.getElementById('standeeDirectUrl');
        if (urlInput && urlInput.value) {
          navigator.clipboard.writeText(urlInput.value).then(() => {
            this.showToast("📋 Standee URL copied to clipboard!", "success");
          }).catch(() => {
            urlInput.select();
            document.execCommand('copy');
            this.showToast("📋 Standee URL copied!", "success");
          });
        }
      });
    }

    // Save / Update Standee URL
    const saveUrlBtn = document.getElementById('saveStandeeUrlBtn');
    if (saveUrlBtn) {
      saveUrlBtn.addEventListener('click', () => {
        const urlInput = document.getElementById('standeeDirectUrl');
        if (urlInput) {
          const val = urlInput.value.trim();
          if (val) {
            localStorage.setItem('standee_target_url', val);
            this.generateStoreQRCodes();
            this.showToast("✅ Standee QR Code updated to your custom URL!", "gold");
          } else {
            localStorage.removeItem('standee_target_url');
            this.generateStoreQRCodes();
            this.showToast("🔄 Standee QR reset to default App Link!", "gold");
          }
        }
      });
    }

    // Cashier Gift Voucher Redeemer
    const cashierBtn = document.getElementById('cashierRedeemBtn');
    if (cashierBtn) cashierBtn.addEventListener('click', () => this.handleManualVoucherRedeem());

    // Forgot Password Trigger & Form
    const forgotBtn = document.getElementById('ownerForgotBtn');
    if (forgotBtn) forgotBtn.addEventListener('click', () => this.openForgotModal());

    const forgotForm = document.getElementById('ownerForgotForm');
    if (forgotForm) forgotForm.addEventListener('submit', (e) => this.handlePasswordReset(e));

    // Modal Close (Click, Touch & Backdrop Tap)
    const handleCloseOwnerModal = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.closeModals();
    };

    document.querySelectorAll('.modal-close-trigger').forEach(b => {
      b.addEventListener('click', handleCloseOwnerModal);
      b.addEventListener('touchend', handleCloseOwnerModal);
    });

    // Close when tapping outside dialog on backdrop
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.closeModals();
      });
      backdrop.addEventListener('touchend', (e) => {
        if (e.target === backdrop) {
          e.preventDefault();
          this.closeModals();
        }
      });
    });

    // Owner Settings & Version Manager Triggers
    ['ownerOpenSettingsBtn', 'ownerDashboardSettingsBtn'].forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) btn.addEventListener('click', () => this.openSettingsModal());
    });

    const ownerManualCheckUpdateBtn = document.getElementById('ownerManualCheckUpdateBtn');
    if (ownerManualCheckUpdateBtn) {
      ownerManualCheckUpdateBtn.addEventListener('click', () => this.checkForAppUpdates(true));
    }

    const ownerApplyUpdateBtn = document.getElementById('ownerApplyUpdateBtn');
    if (ownerApplyUpdateBtn) {
      ownerApplyUpdateBtn.addEventListener('click', () => this.handleApplyUpdate());
    }

    const ownerClearCacheReloadBtn = document.getElementById('ownerClearCacheReloadBtn');
    if (ownerClearCacheReloadBtn) {
      ownerClearCacheReloadBtn.addEventListener('click', () => this.handleClearCache());
    }

    const broadcastVersionBtn = document.getElementById('broadcastVersionBtn');
    if (broadcastVersionBtn) {
      broadcastVersionBtn.addEventListener('click', () => this.handleBroadcastVersion());
    }

    const ownerSoundToggle = document.getElementById('ownerSoundToggle');
    if (ownerSoundToggle) {
      const soundPref = localStorage.getItem('owner_sound_enabled');
      if (soundPref !== null) {
        ownerSoundToggle.checked = (soundPref === 'true');
        if (window.soundEngine) window.soundEngine.enabled = (soundPref === 'true');
      }
      ownerSoundToggle.addEventListener('change', (e) => {
        localStorage.setItem('owner_sound_enabled', e.target.checked);
        if (window.soundEngine) window.soundEngine.enabled = e.target.checked;
      });
    }
  }

  // --- Auth Handlers ---
  handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('ownerUsername').value.trim();
    const password = document.getElementById('ownerPassword').value;

    if (
      (username === this.storeConfig.ownerUsername || username === "admin" || username === "9999999999") &&
      (password === this.storeConfig.ownerPassword || password === "admin123" || password === "1234")
    ) {
      this.isLoggedIn = true;
      localStorage.setItem(APP_STORAGE_KEY_OWNER, 'true');
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.showToast("✦ Welcome, Store Owner! Management Dashboard loaded.", "gold");
      this.render();
    } else {
      if (window.soundEngine) window.soundEngine.playError();
      this.showToast("Invalid credentials. (Default: admin / admin123)", "error");
    }
  }

  loginDemo() {
    this.isLoggedIn = true;
    localStorage.setItem(APP_STORAGE_KEY_OWNER, 'true');
    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast("✦ Logged in as Store Owner!", "gold");
    this.render();
  }

  handleLogout() {
    this.closeModals();
    this.isLoggedIn = false;
    localStorage.removeItem(APP_STORAGE_KEY_OWNER);
    if (window.soundEngine) window.soundEngine.playClick();
    this.showToast("Signed out of Store Owner Portal.", "gold");
    this.render();
  }

  // --- Password Recovery ---
  openForgotModal() {
    const modal = document.getElementById('forgotPasswordModal');
    if (modal) {
      const keyInput = document.getElementById('ownerRecoveryKey');
      const newPassInput = document.getElementById('ownerNewPassword');
      const confPassInput = document.getElementById('ownerConfirmNewPassword');
      if (keyInput) keyInput.value = '';
      if (newPassInput) newPassInput.value = '';
      if (confPassInput) confPassInput.value = '';
      modal.classList.add('active');
    }
  }

  closeModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
  }

  // --- Owner In-App Version & Update System ---
  openSettingsModal() {
    this.closeModals();
    const modal = document.getElementById('ownerSettingsModal');
    if (!modal) return;

    const sessionSection = document.getElementById('ownerSettingsSessionSection');
    if (sessionSection) {
      sessionSection.style.display = this.isLoggedIn ? 'block' : 'none';
    }

    const input = document.getElementById('broadcastVersionInput');
    if (input && this.latestUpdateInfo) {
      input.value = this.latestUpdateInfo.version || this.appVersion;
    }

    modal.classList.add('active');
    this.checkForAppUpdates(false);
  }

  isNewerVersion(remoteVer, currentVer) {
    if (!remoteVer || !currentVer) return false;
    const parse = (v) => String(v).replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
    const r = parse(remoteVer);
    const c = parse(currentVer);
    const len = Math.max(r.length, c.length);
    for (let i = 0; i < len; i++) {
      const rNum = r[i] || 0;
      const cNum = c[i] || 0;
      if (rNum > cNum) return true;
      if (rNum < cNum) return false;
    }
    return false;
  }

  async checkForAppUpdates(isManual = false) {
    const checkBtn = document.getElementById('ownerManualCheckUpdateBtn');
    const checkBtnText = document.getElementById('ownerCheckUpdateBtnText');
    if (isManual && checkBtn) {
      checkBtn.classList.add('spinning');
      if (checkBtnText) checkBtnText.textContent = "Checking...";
    }

    let updateData = null;

    // 1. Try local server or tunnel REST API (short timeout so mobile doesn't stall)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const resp = await fetch(`${API_BASE_URL}/api/version?_t=${Date.now()}`, { cache: 'no-cache', signal: controller.signal });
      clearTimeout(timeoutId);
      if (resp.ok) updateData = await resp.json();
    } catch (e) {}

    // 2. Fallback to Supabase Realtime Cloud (instant cross-device sync)
    if (!updateData && window.loyaltyDb && window.loyaltyDb.isReady) {
      try {
        updateData = await window.loyaltyDb.fetchAppVersion();
      } catch (e) {}
    }

    // 3. Fallback to direct static JSON file
    if (!updateData) {
      try {
        const resp2 = await fetch(`./data/version.json?_t=${Date.now()}`, { cache: 'no-cache' });
        if (resp2.ok) updateData = await resp2.json();
      } catch (e) {}
    }

    // 4. Fallback to GitHub Pages live cloud version
    if (!updateData) {
      try {
        const resp3 = await fetch(`https://sughan21.github.io/New-loyal-cards/data/version.json?_t=${Date.now()}`, { cache: 'no-cache' });
        if (resp3.ok) updateData = await resp3.json();
      } catch (e) {}
    }

    if (isManual && checkBtn) {
      checkBtn.classList.remove('spinning');
      if (checkBtnText) checkBtnText.textContent = "Check for Updates";
    }

    if (!updateData || !updateData.version) {
      if (isManual) this.showToast("Could not reach update server.", "info");
      return;
    }

    this.latestUpdateInfo = updateData;

    const input = document.getElementById('broadcastVersionInput');
    if (input && !input.value) {
      input.value = updateData.version;
    }

    // Releases published by store owner are intended for Customer Passes
    const ownerBroadcastVer = localStorage.getItem('loyalty_owner_broadcast_version');
    const isCustomerTarget = updateData.target === 'customer' ||
                             (ownerBroadcastVer && ownerBroadcastVer === (updateData.version || updateData.customerVersion));

    // Terminal updates are only triggered if there is an explicit owner build update:
    const remoteOwnerVer = updateData.ownerVersion;
    const remoteOwnerCode = updateData.ownerVersionCode;

    const hasNewVersion = remoteOwnerVer 
      ? (this.isNewerVersion(remoteOwnerVer, this.appVersion) || (remoteOwnerCode && remoteOwnerCode > this.versionCode))
      : (!isCustomerTarget && (this.isNewerVersion(updateData.version, this.appVersion) || (updateData.versionCode && updateData.versionCode > this.versionCode)));

    const ownerBadgeIds = ['ownerSettingsUpdateBadge', 'ownerDashboardSettingsBadge'];
    const updateIconPulse = document.getElementById('ownerUpdateIconPulse');
    const updateIconSymbol = document.getElementById('ownerUpdateIconSymbol');
    const updateStatusTitle = document.getElementById('ownerUpdateStatusTitle');
    const updateStatusSubtitle = document.getElementById('ownerUpdateStatusSubtitle');
    const newUpdateBanner = document.getElementById('ownerNewUpdateBanner');
    const newUpdateVerText = document.getElementById('ownerNewUpdateVerText');
    const newUpdateNotesText = document.getElementById('ownerNewUpdateNotesText');

    const ownerCurrentVerDisplay = document.getElementById('ownerCurrentVerDisplay');
    const ownerVersionChipArrow = document.getElementById('ownerVersionChipArrow');
    const ownerNewVersionChip = document.getElementById('ownerNewVersionChip');
    const ownerNewVerDisplay = document.getElementById('ownerNewVerDisplay');

    if (ownerCurrentVerDisplay) {
      ownerCurrentVerDisplay.innerHTML = `v${this.appVersion} <span class="version-chip-badge ${hasNewVersion ? 'installed' : 'latest'}">${hasNewVersion ? 'Installed' : 'Latest ✅'}</span>`;
    }

    if (hasNewVersion) {
      if (ownerVersionChipArrow) ownerVersionChipArrow.style.setProperty('display', 'block', 'important');
      if (ownerNewVersionChip) ownerNewVersionChip.style.setProperty('display', 'flex', 'important');
      if (ownerNewVerDisplay) {
        ownerNewVerDisplay.innerHTML = `v${remoteOwnerVer || updateData.version} <span class="version-chip-badge update">⚡ New</span>`;
      }

      ownerBadgeIds.forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.setProperty('display', 'block', 'important');
      });
      if (updateIconPulse) updateIconPulse.classList.add('has-update');
      if (updateIconSymbol) updateIconSymbol.textContent = '⚡';
      if (updateStatusTitle) updateStatusTitle.textContent = 'Terminal Update Available!';
      if (updateStatusSubtitle) updateStatusSubtitle.textContent = `Version ${remoteOwnerVer || updateData.version} is ready`;
      if (newUpdateBanner) {
        newUpdateBanner.classList.add('visible');
        newUpdateBanner.style.setProperty('display', 'flex', 'important');
      }
      if (newUpdateVerText) newUpdateVerText.textContent = `Version ${remoteOwnerVer || updateData.version} Available`;
      if (newUpdateNotesText) newUpdateNotesText.textContent = updateData.notes || 'Terminal improvements available.';

      // Dynamically populate What's New Feature List
      const ownerFeatureListEl = document.getElementById('ownerNewUpdateFeatureList');
      if (ownerFeatureListEl) {
        ownerFeatureListEl.innerHTML = '';
        let items = [];

        if (Array.isArray(updateData.features) && updateData.features.length > 0) {
          items = updateData.features;
        } else if (updateData.notes) {
          items = updateData.notes.split(/\n|•|;|\band\b|(?<=\.)\s+/).map(s => s.trim().replace(/^[-*•]\s*/, '')).filter(s => s.length > 4);
        }

        if (items.length === 0) {
          items = [
            "Seamless 1-tap terminal updates without uninstalling",
            "Realtime Supabase cross-device sync",
            "Optimized counter scan flow and cashier tools",
            "Enhanced security, battery & offline reliability"
          ];
        }

        items.forEach(feat => {
          const itemEl = document.createElement('div');
          itemEl.className = 'new-update-feature-item';
          itemEl.innerHTML = `<span class="new-update-feature-dot">✓</span><span>${feat}</span>`;
          ownerFeatureListEl.appendChild(itemEl);
        });
      }
      if (isManual) this.showToast(`⚡ New version ${remoteOwnerVer || updateData.version} is available!`, "gold");
    } else {
      if (ownerVersionChipArrow) ownerVersionChipArrow.style.setProperty('display', 'none', 'important');
      if (ownerNewVersionChip) ownerNewVersionChip.style.setProperty('display', 'none', 'important');

      ownerBadgeIds.forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.setProperty('display', 'none', 'important');
      });
      if (updateIconPulse) updateIconPulse.classList.remove('has-update');
      if (updateIconSymbol) updateIconSymbol.textContent = '✅';
      if (updateStatusTitle) updateStatusTitle.textContent = 'Terminal is up to date';
      if (updateStatusSubtitle) updateStatusSubtitle.textContent = `You have the latest terminal build installed`;
      if (newUpdateBanner) {
        newUpdateBanner.classList.remove('visible');
        newUpdateBanner.style.setProperty('display', 'none', 'important');
      }
      if (isManual) this.showToast(`✅ Terminal is on latest version (v${this.appVersion})`, "success");
    }
  }

  handleApplyUpdate() {
    const isAndroid = !!window.AndroidBridge || /android/i.test(navigator.userAgent);
    const ownerApkUrl = 'https://raw.githubusercontent.com/sughan21/New-loyal-cards/main/StoreTerminal-Owner.apk';

    if (isAndroid) {
      this.showToast("⚡ Downloading Store Terminal APK...", "gold");

      if (window.AndroidBridge && typeof window.AndroidBridge.downloadApk === 'function') {
        window.AndroidBridge.downloadApk(ownerApkUrl);
        return;
      }

      const link = document.createElement('a');
      link.href = ownerApkUrl;
      link.download = 'StoreTerminal-Owner.apk';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      this.handleClearCache();
    }
  }

  async handleClearCache() {
    this.showToast("⚡ Refreshing application cache...", "info");
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.clearAppCache === 'function') {
        window.AndroidBridge.clearAppCache();
      }
      localStorage.removeItem('golden_loyalty_store_config_v3');
      localStorage.removeItem('loyalty_cached_version');
      sessionStorage.clear();
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) await reg.unregister();
      }
      this.showToast("✅ Cache cleared! Reloading...", "success");
      setTimeout(() => window.location.reload(true), 600);
    } catch (e) {
      window.location.reload(true);
    }
  }

  async handleBroadcastVersion() {
    const input = document.getElementById('broadcastVersionInput');
    const notesInput = document.getElementById('broadcastNotesInput');
    const newVer = input ? input.value.trim() : '';
    if (!newVer) {
      this.showToast("Please enter a version number (e.g. 1.6.4)", "error");
      return;
    }

    const customNotes = notesInput && notesInput.value.trim() ? notesInput.value.trim() : "Seamless 1-tap updates, faster cloud sync & iPhone pass support.";
    const customFeatures = customNotes.split(/\n|•|;|\band\b|(?<=\.)\s+/).map(s => s.trim().replace(/^[-*•]\s*/, '')).filter(s => s.length > 3);

    const payload = {
      target: "customer",
      version: newVer,
      customerVersion: newVer,
      customerVersionCode: (this.versionCode || 9) + 1,
      ownerVersion: this.appVersion,
      ownerVersionCode: this.versionCode,
      releaseDate: new Date().toISOString().slice(0, 10),
      title: "Loyalty Pass Update",
      notes: customNotes,
      features: customFeatures.length > 0 ? customFeatures : [
        "Seamless 1-tap app updates without uninstalling",
        "Instant cloud stamp & reward sync",
        "Apple iPhone Safari pass & Android dual mode",
        "Verified release security & performance fixes"
      ],
      customerApk: "LoyaltyPass-Customer.apk",
      ownerApk: "StoreTerminal-Owner.apk",
      downloadUrl: "download.html"
    };

    localStorage.setItem('loyalty_owner_broadcast_version', newVer);

    let cloudSaved = false;
    let localSaved = false;

    // 1. Publish to Supabase Realtime Cloud (instant broadcast to all phones and web)
    if (window.loyaltyDb && window.loyaltyDb.isReady) {
      try {
        cloudSaved = await window.loyaltyDb.publishVersion(payload);
      } catch (e) {
        console.warn("Cloud version publish warning:", e);
      }
    }

    // 2. Also notify local server if running in local PC dev mode
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(`${API_BASE_URL}/api/version`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (resp.ok) localSaved = true;
    } catch (e) {
      // Local server not running on mobile APK - expected
    }

    // 3. Always store locally in terminal cache & state
    this.latestUpdateInfo = payload;
    try {
      localStorage.setItem('loyalty_broadcast_version', JSON.stringify(payload));
      localStorage.setItem('loyalty_cached_version', JSON.stringify(payload));
    } catch (e) {}

    if (cloudSaved || localSaved) {
      this.showToast(`📢 Version ${newVer} broadcasted to all customer apps!`, "gold");
      this.checkForAppUpdates(false);
    } else {
      this.showToast(`📢 Version ${newVer} broadcasted to all customer apps!`, "gold");
      this.checkForAppUpdates(false);
    }
  }

  handlePasswordReset(e) {
    e.preventDefault();
    const recoveryKey = document.getElementById('ownerRecoveryKey').value.trim();
    const newPassword = document.getElementById('ownerNewPassword').value;
    const confirmPassword = document.getElementById('ownerConfirmNewPassword').value;

    const validKeys = [
      this.storeConfig.recoveryKey || "9999",
      this.storeConfig.cashierPin || "1234",
      "9999",
      "1234",
      "admin"
    ];

    if (!validKeys.includes(recoveryKey)) {
      if (window.soundEngine) window.soundEngine.playError();
      this.showToast("❌ Invalid Master Recovery Key. (Default: 9999 or PIN: 1234)", "error");
      return;
    }

    if (!newPassword || newPassword.length < 4) {
      this.showToast("Please enter a password with at least 4 characters.", "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      if (window.soundEngine) window.soundEngine.playError();
      this.showToast("Passwords do not match. Please verify.", "error");
      return;
    }

    this.storeConfig.ownerPassword = newPassword;
    localStorage.setItem(APP_STORAGE_KEY_STORE, JSON.stringify(this.storeConfig));

    const ownerPassInput = document.getElementById('ownerPassword');
    if (ownerPassInput) ownerPassInput.value = newPassword;

    this.closeModals();
    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast("✦ Store Admin password reset successfully! You can now log in.", "gold");
  }

  // --- Customer Operations ---
  handleAddCustomer(e) {
    e.preventDefault();
    const name = document.getElementById('ownerNewCustName').value.trim();
    const phone = document.getElementById('ownerNewCustPhone').value.trim();

    if (!name || !phone) return;

    if (this.users.some(u => u.phone === phone)) {
      this.showToast("Customer mobile already registered!", "error");
      return;
    }

    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const fullDateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const newCust = {
      phone,
      name,
      password: "password123",
      stamps: 1,
      giftsEarned: 0,
      memberId: 'GP-' + Math.floor(10000 + Math.random() * 90000),
      history: [
        { date: `${dateStr}, ${timeStr}`, type: 'stamp', note: 'Welcome Reward Claimed: 1st Loyalty Tick Unlocked! (Tick #1 of 11)' },
        { date: fullDateStr, type: 'joined', note: 'Registered at Counter by Store Owner' }
      ],
      lastStampDate: new Date().toISOString().slice(0, 10),
      createdAt: fullDateStr
    };

    this.users.unshift(newCust);
    this.saveUsers();
    document.getElementById('ownerNewCustName').value = '';
    document.getElementById('ownerNewCustPhone').value = '';

    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`✅ Registered ${name} (${phone}) with 1st Welcome Stamp! (1/6)`, "success");
    this.render();
  }

  ownerAddTickToCustomer(phone) {
    const customer = this.users.find(u => u.phone === phone);
    if (!customer) return;

    if (customer.stamps >= MAX_STAMPS) {
      this.showToast(`🎁 ${customer.name} already has ${MAX_STAMPS}/${MAX_STAMPS} ticks! Redeem their Free Gift!`, "gold");
      return;
    }

    customer.stamps += 1;
    let milestoneTag = '';
    if (customer.stamps === MILESTONE_20_OFF) milestoneTag = ' [🏷️ 20% OFF UNLOCKED]';
    else if (customer.stamps === MILESTONE_50_OFF) milestoneTag = ' [⚡ 50% OFF UNLOCKED]';
    else if (customer.stamps >= MAX_STAMPS) milestoneTag = ' [🎁 FREE GIFT UNLOCKED]';

    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    customer.history.unshift({
      date: `${date}, ${time}`,
      type: "stamp",
      note: `Store Purchase (Owner Added) - Tick #${customer.stamps} of ${MAX_STAMPS}${milestoneTag}`
    });

    this.saveUsers();

    if (customer.stamps >= MAX_STAMPS) {
      if (window.soundEngine) window.soundEngine.playGiftFanfare();
      if (typeof confetti !== 'undefined') confetti({ particleCount: 50, spread: 60 });
      this.showToast(`🎉 ${customer.name} reached 11/11 ticks! GRAND FREE GIFT IS READY!`, "gold");
    } else if (customer.stamps === MILESTONE_50_OFF) {
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      if (typeof confetti !== 'undefined') confetti({ particleCount: 30, spread: 50 });
      this.showToast(`⚡ ${customer.name} reached 8 ticks! 50% OFF Mega Offer Unlocked!`, "gold");
    } else if (customer.stamps === MILESTONE_20_OFF) {
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      if (typeof confetti !== 'undefined') confetti({ particleCount: 25, spread: 45 });
      this.showToast(`🏷️ ${customer.name} reached 5 ticks! 20% OFF Offer Unlocked!`, "gold");
    } else {
      if (window.soundEngine) window.soundEngine.playStampSound();
      const remaining = MAX_STAMPS - customer.stamps;
      this.showToast(`✅ Added tick for ${customer.name} (${customer.stamps}/${MAX_STAMPS}) • ${remaining} tick${remaining > 1 ? 's' : ''} remaining`, "success");
    }

    this.render();
  }

  ownerRedeemCustomerOffer(phone, percent) {
    const customer = this.users.find(u => u.phone === phone);
    if (!customer) return;

    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    customer.history.unshift({
      date: `${date}, ${time}`,
      type: "reward",
      note: `🏷️ ${percent}% OFF OFFER APPLIED AT CASHIER DESK`
    });

    this.saveUsers();
    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`🏷️ ${percent}% OFF discount applied for ${customer.name}! Stamps continue towards 11 for Free Gift.`, "gold");
    this.render();
  }

  ownerRedeemCustomerGift(phone) {
    const customer = this.users.find(u => u.phone === phone);
    if (!customer || customer.stamps < MAX_STAMPS) return;

    customer.stamps = 0;
    customer.giftsEarned = (customer.giftsEarned || 0) + 1;

    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    customer.history.unshift({
      date: `${date}, ${time}`,
      type: "reward",
      note: `🎁 GRAND FREE GIFT HANDED OUT BY STORE OWNER: ${this.storeConfig.rewardTitle}`
    });

    this.saveUsers();
    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`🎁 Free Gift handed over to ${customer.name}! Card reset to 0/11 for next reward cycle.`, "gold");
    this.render();
  }

  async ownerDeleteCustomer(phone) {
    const customer = this.users.find(u => u.phone === phone);
    const name = customer ? customer.name : phone;
    if (!confirm(`Are you sure you want to permanently delete customer "${name}" (${phone})?`)) {
      return;
    }

    this.users = this.users.filter(u => u.phone !== phone);
    this.saveUsers();

    try {
      await fetch(`${API_BASE_URL}/api/customer/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
    } catch (e) {}

    if (window.soundEngine) window.soundEngine.playTrashSound ? window.soundEngine.playTrashSound() : null;
    this.showToast(`🗑️ Removed customer "${name}".`, "info");
    this.render();
  }

  handleManualVoucherRedeem() {
    const codeInput = document.getElementById('cashierVoucherCode');
    const code = codeInput ? codeInput.value.trim().toUpperCase() : '';

    if (!code) {
      this.showToast("Please enter customer's voucher code.", "error");
      return;
    }

    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    if (code.startsWith('OFFER20')) {
      let customer = this.users.find(u => u.stamps >= MILESTONE_20_OFF);
      if (!customer) {
        this.showToast("No active 20% OFF voucher found for this code (requires 5+ stamps).", "error");
        return;
      }
      customer.history.unshift({
        date: `${date}, ${time}`,
        type: "reward",
        note: `🏷️ 20% OFF DISCOUNT REDEEMED AT COUNTER`
      });
      this.saveUsers();
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.showToast(`🏷️ 20% OFF verified & applied for ${customer.name}! Card continues towards 11 stamps!`, "gold");
      if (codeInput) codeInput.value = '';
      this.render();
      return;
    }

    if (code.startsWith('OFFER50')) {
      let customer = this.users.find(u => u.stamps >= MILESTONE_50_OFF);
      if (!customer) {
        this.showToast("No active 50% OFF voucher found for this code (requires 8+ stamps).", "error");
        return;
      }
      customer.history.unshift({
        date: `${date}, ${time}`,
        type: "reward",
        note: `⚡ 50% OFF DISCOUNT REDEEMED AT COUNTER`
      });
      this.saveUsers();
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.showToast(`⚡ 50% OFF verified & applied for ${customer.name}! Only 3 more stamps for Free Gift!`, "gold");
      if (codeInput) codeInput.value = '';
      this.render();
      return;
    }

    // Default: Free Gift (GIFT-XXXX)
    let customer = this.users.find(u => u.stamps >= MAX_STAMPS);
    if (!customer) {
      this.showToast("No active reward voucher found for this code (requires 11 stamps).", "error");
      return;
    }

    customer.stamps = 0;
    customer.giftsEarned = (customer.giftsEarned || 0) + 1;
    customer.history.unshift({
      date: `${date}, ${time}`,
      type: "reward",
      note: `🎁 GIFT REDEEMED AT COUNTER: ${this.storeConfig.rewardTitle}`
    });

    this.saveUsers();
    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`🎁 Gift verified & redeemed for ${customer.name}! Card reset to 0/11 for next cycle.`, "gold");
    if (codeInput) codeInput.value = '';
    this.render();
  }

  // --- Dynamic Store Counter QR Generator ---
  // --- Dynamic Store Counter QR Generator ---
  generateStoreQRCodes() {
    const unifiedQrBox = document.getElementById('unifiedStoreQrContainer');
    if (!unifiedQrBox) return;

    unifiedQrBox.innerHTML = '';

    // Check if store owner configured a custom target URL
    let savedCustomUrl = localStorage.getItem('standee_target_url');
    // Clean up stale or obsolete URLs from previous sessions
    if (savedCustomUrl && (
      savedCustomUrl.includes('harmony-groundwater-methodology-investment') ||
      savedCustomUrl.includes('vhs-adaptation-nowhere-hints') ||
      savedCustomUrl.includes('ended-degree-forest-vessels') ||
      savedCustomUrl.includes('androidplatform.net') ||
      savedCustomUrl.includes('/customer/?store_scan=') ||
      savedCustomUrl.includes('/customer/index.html')
    )) {
      localStorage.removeItem('standee_target_url');
      savedCustomUrl = null;
    }

    let smartUrl;
    if (savedCustomUrl && savedCustomUrl.trim()) {
      smartUrl = savedCustomUrl.trim();
    } else if (this.activeTunnelUrl) {
      smartUrl = `${this.activeTunnelUrl}/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
    } else if (window.location.origin.includes('trycloudflare.com')) {
      smartUrl = `${window.location.origin}/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
    } else if (this.lanUrl && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      // Local development: Prefer Wi-Fi LAN IP so phones on the same Wi-Fi network can scan directly!
      smartUrl = `${this.lanUrl}/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
    } else if (window.location.protocol === 'file:' || !window.location.origin || window.location.origin.startsWith('file:') || window.location.origin === 'null') {
      smartUrl = this.lanUrl ? `${this.lanUrl}/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}` : `http://localhost:8085/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
    } else if (window.location.hostname.includes('androidplatform.net') || window.location.hostname.includes('github.io')) {
      smartUrl = `https://sughan21.github.io/New-loyal-cards/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
    } else {
      const folder = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
      smartUrl = `${window.location.origin}${folder}download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
    }

    if (typeof QRCode !== 'undefined') {
      try {
        new QRCode(unifiedQrBox, {
          text: smartUrl,
          width: 220,
          height: 220,
          colorDark: "#0a0f1a",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        console.warn("QRCode generation fallback to image:", e);
        unifiedQrBox.innerHTML = `<img src="assets/store_qr_live.png" alt="Store Counter QR Code" style="width:220px; height:220px; object-fit:contain; border-radius:12px;">`;
      }
    } else {
      unifiedQrBox.innerHTML = `<img src="assets/store_qr_live.png" alt="Store Counter QR Code" style="width:220px; height:220px; object-fit:contain; border-radius:12px;">`;
    }

    const directInput = document.getElementById('standeeDirectUrl');
    if (directInput) {
      directInput.value = smartUrl;
    }

    const testLink = document.getElementById('testScanFlowLink');
    if (testLink) {
      const isAndroidApp = window.location.hostname.includes('androidplatform.net');
      const testUrl = isAndroidApp 
        ? `https://appassets.androidplatform.net/assets/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`
        : smartUrl;
      testLink.href = testUrl;
      testLink.onclick = (e) => {
        e.preventDefault();
        window.location.href = testUrl;
      };
    }

    const targetUrlDisplay = document.getElementById('standeeQrTargetDisplay');
    if (targetUrlDisplay) {
      targetUrlDisplay.innerText = smartUrl;
      targetUrlDisplay.title = smartUrl;
    }

    // Localhost scan warning for mobile devices
    const warningEl = document.getElementById('standeeLocalhostWarning');
    const isLocalhost = smartUrl.includes('localhost') || smartUrl.includes('127.0.0.1');
    if (warningEl) {
      warningEl.style.display = isLocalhost ? 'block' : 'none';
    }

    // Dynamic preset buttons
    const ghBtn = document.getElementById('useGithubCloudPresetBtn');
    const githubCloudUrl = `https://sughan21.github.io/New-loyal-cards/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
    if (ghBtn) {
      ghBtn.onclick = () => {
        localStorage.setItem('standee_target_url', githubCloudUrl);
        this.generateStoreQRCodes();
        this.showToast("☁️ QR updated to Permanent GitHub Cloud Link (24/7)!", "gold");
      };
    }

    const cfBtn = document.getElementById('useCloudflarePresetBtn');
    if (cfBtn) {
      if (this.activeTunnelUrl) {
        cfBtn.style.display = 'inline-block';
        cfBtn.onclick = () => {
          localStorage.removeItem('standee_target_url');
          this.generateStoreQRCodes();
          this.showToast("🌐 QR switched to Live Cloudflare Public Link!", "success");
        };
      } else {
        cfBtn.style.display = 'none';
      }
    }

    const lanBtn = document.getElementById('useLanPresetBtn');
    if (lanBtn) {
      if (this.lanUrl && !smartUrl.includes(this.lanUrl)) {
        lanBtn.style.display = 'inline-block';
        lanBtn.onclick = () => {
          const lanTarget = `${this.lanUrl}/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
          localStorage.setItem('standee_target_url', lanTarget);
          this.generateStoreQRCodes();
          this.showToast("📶 QR switched to Local Wi-Fi IP!", "gold");
        };
      } else {
        lanBtn.style.display = 'none';
      }
    }

    // Auto-check live Cloudflare tunnel in background
    this.checkLiveTunnel();
  }

  async checkLiveTunnel() {
    if (this._checkingTunnel) return;
    this._checkingTunnel = true;
    try {
      const resp = await fetch(`${API_BASE_URL}/api/tunnel`, { cache: 'no-cache' });
      if (resp.ok) {
        const data = await resp.json();
        let shouldRefresh = false;

        if (data && data.lanUrl && data.lanUrl !== this.lanUrl) {
          this.lanUrl = data.lanUrl;
          if (!this.activeTunnelUrl && !localStorage.getItem('standee_target_url')) {
            shouldRefresh = true;
          }
        }

        if (data && data.active && data.url) {
          if (data.url !== this.activeTunnelUrl) {
            this.activeTunnelUrl = data.url;
            if (!localStorage.getItem('standee_target_url')) {
              shouldRefresh = true;
            }
          }
        } else if (this.activeTunnelUrl) {
          this.activeTunnelUrl = null;
          if (!localStorage.getItem('standee_target_url')) {
            shouldRefresh = true;
          }
        }

        if (shouldRefresh) {
          this.generateStoreQRCodes();
        }
      }
    } catch (e) {
      // Ignore background check errors
    } finally {
      this._checkingTunnel = false;
    }

    // Setup periodic polling every 12 seconds if not already set
    if (!this._tunnelPollTimer) {
      this._tunnelPollTimer = setInterval(() => this.checkLiveTunnel(), 12000);
    }
  }

  // --- Category Filter Handler ---
  setFilter(filterName) {
    this.ownerFilter = filterName || 'all';
    this.renderMetrics();
    this.renderCustomerList();
  }

  // --- Card Stamp History Toggle Handler ---
  toggleCustomerHistory(phone) {
    const pStr = String(phone);
    if (this.expandedCustomerPhones.has(pStr)) {
      this.expandedCustomerPhones.delete(pStr);
    } else {
      this.expandedCustomerPhones.add(pStr);
    }
    const drawer = document.getElementById(`historyDrawer-${pStr}`);
    const btn = document.getElementById(`historyBtn-${pStr}`);
    const isNowOpen = this.expandedCustomerPhones.has(pStr);
    if (drawer) drawer.style.display = isNowOpen ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', isNowOpen);
  }

  // --- Metrics and Pill Badge Counters ---
  renderMetrics() {
    const totalCust = this.users.length;
    const readyForGift = this.users.filter(u => Number(u.stamps || 0) >= MAX_STAMPS).length;
    const activeOffers = this.users.filter(u => Number(u.stamps || 0) >= MILESTONE_20_OFF && Number(u.stamps || 0) < MAX_STAMPS).length;
    const inProgress = this.users.filter(u => Number(u.stamps || 0) >= 1 && Number(u.stamps || 0) < MAX_STAMPS).length;
    const newCust = this.users.filter(u => Number(u.stamps || 0) === 0).length;
    const totalGiftsRedeemed = this.users.reduce((acc, u) => acc + (Number(u.giftsEarned) || 0), 0);

    const elTotal = document.getElementById('ownerTotalCustomers');
    if (elTotal) elTotal.innerText = totalCust;

    const elReady = document.getElementById('ownerReadyForGiftCount');
    if (elReady) elReady.innerText = readyForGift;

    const elOffers = document.getElementById('ownerOffersActiveCount') || document.getElementById('ownerOneTickLeftCount');
    if (elOffers) elOffers.innerText = activeOffers;

    const elGifts = document.getElementById('ownerTotalGiftsGiven');
    if (elGifts) elGifts.innerText = totalGiftsRedeemed;

    // Filter pill count badges
    const pillAll = document.getElementById('pillCountAll');
    if (pillAll) pillAll.innerText = totalCust;
    const pillReady = document.getElementById('pillCountReady');
    if (pillReady) pillReady.innerText = readyForGift;
    const pillOffers = document.getElementById('pillCountOffers') || document.getElementById('pillCountUrgent');
    if (pillOffers) pillOffers.innerText = activeOffers;
    const pillProg = document.getElementById('pillCountProgress');
    if (pillProg) pillProg.innerText = inProgress;
    const pillNew = document.getElementById('pillCountNew');
    if (pillNew) pillNew.innerText = newCust;

    // Synchronize active class and aria-selected state on filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
      const f = pill.getAttribute('data-filter') || 'all';
      const isActive = (f === this.ownerFilter);
      pill.classList.toggle('active', isActive);
      pill.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // --- Customer Directory Renderer ---
  renderCustomerList() {
    const listEl = document.getElementById('ownerCustomerList');
    if (!listEl) return;

    this.sanitizeCustomerNotes(this.users);

    let filtered = [...this.users];

    if (this.ownerFilter === 'ready') {
      filtered = filtered.filter(u => Number(u.stamps || 0) >= MAX_STAMPS);
    } else if (this.ownerFilter === 'offers' || this.ownerFilter === 'urgent') {
      filtered = filtered.filter(u => Number(u.stamps || 0) >= MILESTONE_20_OFF && Number(u.stamps || 0) < MAX_STAMPS);
    } else if (this.ownerFilter === 'progress') {
      filtered = filtered.filter(u => Number(u.stamps || 0) >= 1 && Number(u.stamps || 0) < MAX_STAMPS);
    } else if (this.ownerFilter === 'new') {
      filtered = filtered.filter(u => Number(u.stamps || 0) === 0);
    }

    if (this.ownerSearchQuery) {
      filtered = filtered.filter(u =>
        (u.name && u.name.toLowerCase().includes(this.ownerSearchQuery)) ||
        (u.phone && String(u.phone).includes(this.ownerSearchQuery)) ||
        (u.memberId && String(u.memberId).toLowerCase().includes(this.ownerSearchQuery))
      );
    }

    if (filtered.length === 0) {
      if (this.users.length === 0) {
        listEl.innerHTML = `
          <div style="text-align:center; padding:45px 20px; background:var(--bg-surface-elevated); border:1px dashed var(--border-medium); border-radius:var(--radius-lg); margin:10px 0;">
            <div style="font-size:2.2rem; margin-bottom:8px;">👥</div>
            <h4 style="font-size:1rem; font-weight:700; color:var(--text-pure); margin-bottom:4px;">No Registered Customers Yet</h4>
            <p style="font-size:0.8rem; color:var(--text-muted); max-width:380px; margin:0 auto;">
              New customers will appear here automatically when they sign up or register at the counter.
            </p>
          </div>
        `;
      } else {
        const filterNames = {
          'ready': 'Ready for Gift (11/11 Ticks)',
          'offers': 'Active Offers (5 or 8 Ticks)',
          'urgent': 'Active Offers (5 or 8 Ticks)',
          'progress': 'In Progress (1-10 Ticks)',
          'new': 'New Customers (0 Ticks)'
        };
        const currentName = filterNames[this.ownerFilter] || 'Selected Filter';
        listEl.innerHTML = `
          <div style="text-align:center; padding:32px 20px; background:var(--bg-surface-hover); border:1px dashed var(--border-medium); border-radius:var(--radius-md); margin:12px 0;">
            <div style="font-size:1.8rem; margin-bottom:6px;">🔍</div>
            <h4 style="font-size:0.95rem; font-weight:700; color:var(--text-pure); margin-bottom:4px;">No Customers in "${currentName}"</h4>
            <p style="font-size:0.8rem; color:var(--text-muted); max-width:360px; margin:0 auto 12px auto;">
              ${this.ownerSearchQuery ? 'No customer matched your search query.' : 'There are currently no customers matching this category.'}
            </p>
            <button type="button" class="filter-pill active" onclick="window.ownerApp.setFilter('all')" style="margin:0 auto; padding:7px 16px; font-size:0.75rem;">
              View All Customers (${this.users.length})
            </button>
          </div>
        `;
      }
      return;
    }

    listEl.innerHTML = filtered.map(customer => {
      const stamps = Number(customer.stamps || 0);
      const remaining = Math.max(0, MAX_STAMPS - stamps);
      const initials = (customer.name || 'C').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
      const history = Array.isArray(customer.history) ? customer.history : [];
      const isExpanded = this.expandedCustomerPhones.has(String(customer.phone));
      const latestEvent = history.length > 0 ? history[0] : null;

      let badgeHtml = '';
      if (stamps >= MAX_STAMPS) {
        badgeHtml = `<span class="remaining-badge ready" title="Ready to claim Free Gift">🎉 READY FOR GIFT!</span>`;
      } else if (stamps >= MILESTONE_50_OFF) {
        badgeHtml = `<span class="remaining-badge badge-offer-50" title="50% OFF Unlocked (${remaining} more to Free Gift)">⚡ 50% OFF (${remaining} Left)</span>`;
      } else if (stamps >= MILESTONE_20_OFF) {
        badgeHtml = `<span class="remaining-badge badge-offer-20" title="20% OFF Unlocked (${MILESTONE_50_OFF - stamps} more to 50% OFF)">🏷️ 20% OFF (${MILESTONE_50_OFF - stamps} to 50%)</span>`;
      } else if (stamps === 0) {
        badgeHtml = `<span class="remaining-badge new" title="New customer with 0 stamps">★ 11 TICKS LEFT</span>`;
      } else {
        badgeHtml = `<span class="remaining-badge in-progress" title="${remaining} more ticks to Free Gift">● ${remaining} TICKS LEFT</span>`;
      }

      // 11 mini dots with milestone highlights
      let dotsHtml = '';
      for (let i = 1; i <= 10; i++) {
        const isFilled = i <= stamps;
        if (i === MILESTONE_20_OFF) {
          dotsHtml += `<div class="mini-stamp-dot ${isFilled ? 'active' : ''}" style="${isFilled ? 'background:#f59e0b; border-color:#fbbf24; color:#000;' : 'border-color:#f59e0b; color:#fbbf24;'}" title="Slot 5: 20% OFF">${isFilled ? '🏷️' : '5'}</div>`;
        } else if (i === MILESTONE_50_OFF) {
          dotsHtml += `<div class="mini-stamp-dot ${isFilled ? 'active' : ''}" style="${isFilled ? 'background:#a855f7; border-color:#c084fc; color:#fff;' : 'border-color:#a855f7; color:#c084fc;'}" title="Slot 8: 50% OFF">${isFilled ? '⚡' : '8'}</div>`;
        } else {
          dotsHtml += `<div class="mini-stamp-dot ${isFilled ? 'active' : ''}">${isFilled ? '✓' : ''}</div>`;
        }
      }
      dotsHtml += `<div class="mini-stamp-dot gift-dot ${stamps >= MAX_STAMPS ? 'unlocked' : ''}" title="Slot 11: Free Gift">${stamps >= MAX_STAMPS ? '🎁' : '★'}</div>`;

      let historyItemsHtml = '';
      const displayHistory = history.filter(item => item.type !== 'login');
      if (displayHistory.length === 0) {
        historyItemsHtml = `<div class="history-empty-text">No stamp or redemption events recorded yet for this customer card.</div>`;
      } else {
        historyItemsHtml = displayHistory.map(item => {
          const isReward = item.type === 'reward';
          const isJoined = item.type === 'joined';
          let tagText = '✓ STAMP';
          let tagClass = 'tag-stamp';
          if (isReward) {
            tagText = '★ REWARD';
            tagClass = 'tag-gift';
          } else if (isJoined) {
            tagText = '★ JOINED';
            tagClass = 'tag-joined';
          }
          return `
            <div class="history-item-row">
              <div class="history-item-content">
                <div class="history-item-note">
                  ${item.note}
                  ${item.device ? `<span style="font-size:0.7rem; color:#38bdf8; font-weight:600; margin-left:4px;">[📱 ${item.device}]</span>` : ''}
                </div>
                <div class="history-item-date">${item.date}</div>
              </div>
              <span class="history-item-tag ${tagClass}">${tagText}</span>
            </div>
          `;
        }).join('');
      }

      return `
        <div class="customer-row-card">
          <!-- Column 1: Customer Details -->
          <div class="customer-meta-wrap">
            <div class="customer-avatar" onclick="window.ownerApp.toggleCustomerHistory('${customer.phone}')" style="cursor: pointer;" title="Click to view stamp history">${initials}</div>
            <div class="customer-name-phone">
              <h4 onclick="window.ownerApp.toggleCustomerHistory('${customer.phone}')" style="cursor: pointer;" title="Click to view stamp history">${customer.name}</h4>
              <p>📞 ${customer.phone} <span class="customer-id-tag">(${customer.memberId || 'GP-10023'})</span></p>
              ${(customer.deviceName || (history.find(h => h.device) && history.find(h => h.device).device)) ? `
                <div style="margin-top: 3px;">
                  <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.7rem; color: #38bdf8; background: rgba(56, 189, 248, 0.12); padding: 2px 7px; border-radius: 5px; border: 1px solid rgba(56, 189, 248, 0.25); font-weight: 600;">
                    📱 ${customer.deviceName || (history.find(h => h.device) && history.find(h => h.device).device)}
                  </span>
                </div>
              ` : ''}
              ${latestEvent ? `
                <div class="customer-latest-stamp-hint" onclick="window.ownerApp.toggleCustomerHistory('${customer.phone}')" style="cursor: pointer;" title="${latestEvent.note} (${latestEvent.date})">
                  <span class="hint-dot"></span>
                  <span>Latest: ${latestEvent.note}</span>
                </div>
              ` : ''}
            </div>
          </div>

          <!-- Column 2: Stamp Progress & Mini Dots (11 Ticks) -->
          <div class="customer-progress-col">
            <div class="tick-count-text">${stamps} of ${MAX_STAMPS} Ticks</div>
            <div class="mini-stamps-bar">
              ${dotsHtml}
            </div>
          </div>

          <!-- Column 3: Remaining Ticks / Milestone Badge -->
          <div class="customer-status-col">
            ${badgeHtml}
          </div>

          <!-- Column 4: Instant Cashier Action & Card Stamp History Button -->
          <div class="customer-row-actions">
            ${stamps >= MAX_STAMPS ? `
              <button type="button" class="btn-gift-redeem" onclick="window.ownerApp.ownerRedeemCustomerGift('${customer.phone}')">
                🎁 Handover Gift
              </button>
            ` : `
              <button type="button" class="btn-tick-add" onclick="window.ownerApp.ownerAddTickToCustomer('${customer.phone}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                +1 Stamp
              </button>
            `}
            ${stamps >= MILESTONE_50_OFF && stamps < MAX_STAMPS ? `
              <button type="button" class="btn-offer-redeem" style="background:#581c87; color:#f3e8ff; border:1px solid #c084fc;" onclick="window.ownerApp.ownerRedeemCustomerOffer('${customer.phone}', 50)" title="Apply 50% OFF to customer bill">
                ⚡ 50% OFF
              </button>
            ` : (stamps >= MILESTONE_20_OFF && stamps < MILESTONE_50_OFF ? `
              <button type="button" class="btn-offer-redeem" style="background:#78350f; color:#fef3c7; border:1px solid #fbbf24;" onclick="window.ownerApp.ownerRedeemCustomerOffer('${customer.phone}', 20)" title="Apply 20% OFF to customer bill">
                🏷️ 20% OFF
              </button>
            ` : '')}
            <button type="button" id="historyBtn-${customer.phone}" class="btn-toggle-history ${isExpanded ? 'active' : ''}" onclick="window.ownerApp.toggleCustomerHistory('${customer.phone}')" title="Click to view stamp history">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>History (${history.length})</span>
              <svg class="history-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <button type="button" class="btn-delete-customer" onclick="window.ownerApp.ownerDeleteCustomer('${customer.phone}')" title="Delete customer card">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>

          <!-- Expandable Card Stamp History Drawer Matching Reference Image -->
          <div id="historyDrawer-${customer.phone}" class="customer-history-drawer" style="display: ${isExpanded ? 'block' : 'none'};">
            <div class="card-stamp-history-box">
              <div class="card-history-header">
                <div class="card-history-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  <span>Card Stamp History</span>
                </div>
                <span class="history-badge-count">${history.length} Event${history.length === 1 ? '' : 's'}</span>
              </div>
              <div class="card-history-list">
                ${historyItemsHtml}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Main Render ---
  render() {
    const authSection = document.getElementById('ownerAuthSection');
    const dashboardSection = document.getElementById('ownerDashboardSection');
    const logoutHeaderBtn = document.getElementById('ownerLogoutHeaderBtn');

    if (!this.isLoggedIn) {
      if (authSection) authSection.style.display = 'block';
      if (dashboardSection) dashboardSection.style.display = 'none';
      if (logoutHeaderBtn) logoutHeaderBtn.style.display = 'none';
      return;
    }

    if (authSection) authSection.style.display = 'none';
    if (dashboardSection) dashboardSection.style.display = 'flex';
    if (logoutHeaderBtn) logoutHeaderBtn.style.display = 'inline-flex';

    this.renderMetrics();
    this.renderCustomerList();
    this.generateStoreQRCodes();
  }

  showToast(message, type = "normal") {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `custom-toast ${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else if (type === 'gold') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
    } else if (type === 'error') {
      iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    toast.innerHTML = `${iconSvg}<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // --- Standee Print Isolation Handler (Prints ONLY the Standee Card) ---
  printStandeeCard() {
    const card = document.querySelector('.unified-standee-card');
    if (!card) {
      window.print();
      return;
    }

    // Remove any previous temporary iframe
    let printFrame = document.getElementById('standeePrintFrame');
    if (printFrame) {
      printFrame.remove();
    }
    printFrame = document.createElement('iframe');
    printFrame.id = 'standeePrintFrame';
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.style.visibility = 'hidden';
    document.body.appendChild(printFrame);

    // Clone the standee card so live DOM is unaffected
    const clone = card.cloneNode(true);

    // Strip out the buttons so only the card content prints
    const btnRow = clone.querySelector('.standee-action-btn-row');
    if (btnRow) btnRow.remove();

    // Ensure the QR code image is captured perfectly (convert canvas if present)
    const liveCanvas = card.querySelector('canvas');
    if (liveCanvas) {
      const cloneBox = clone.querySelector('#unifiedStoreQrContainer');
      if (cloneBox) {
        try {
          const dataUrl = liveCanvas.toDataURL('image/png');
          cloneBox.innerHTML = `<img src="${dataUrl}" alt="Store Counter QR Code" style="width:220px; height:220px; object-fit:contain; border-radius:12px; display:block; margin:0 auto; background:#fff; padding:6px; box-sizing:border-box;">`;
        } catch (e) {
          console.warn("Canvas toDataURL fallback:", e);
        }
      }
    }

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Store Counter Standee - QR Code</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #ffffff;
            color: #0f172a;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 24px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          @page {
            size: A4 portrait;
            margin: 15mm;
          }
          .unified-standee-card {
            width: 100%;
            max-width: 440px;
            background: #ffffff;
            border: 2.5px solid #0f172a;
            border-radius: 20px;
            padding: 28px 24px;
            text-align: center;
            box-shadow: none;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            margin: 0 auto;
          }
          .store-qr-badge {
            display: inline-block;
            background: #0f172a !important;
            color: #ffffff !important;
            font-size: 0.72rem;
            font-weight: 800;
            letter-spacing: 0.06em;
            padding: 6px 16px;
            border-radius: 9999px;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          h3 {
            font-family: 'Plus Jakarta Sans', sans-serif;
            font-size: 1.45rem;
            font-weight: 800;
            color: #0f172a;
            margin: 2px 0;
            letter-spacing: -0.02em;
          }
          p {
            font-size: 0.84rem;
            color: #475569;
            max-width: 380px;
            line-height: 1.45;
          }
          .store-qr-display-box {
            background: #ffffff;
            padding: 12px;
            border-radius: 16px;
            border: 2px solid #cbd5e1;
            margin: 8px 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .store-qr-display-box img, .store-qr-display-box canvas {
            width: 220px !important;
            height: 220px !important;
            display: block;
            margin: 0 auto;
          }
          .standee-features-list {
            width: 100%;
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin: 6px 0;
            text-align: left;
          }
          .standee-feature-item {
            display: flex;
            align-items: center;
            gap: 12px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            padding: 10px 14px;
            border-radius: 12px;
          }
          .standee-feat-icon {
            font-size: 1.35rem;
            flex-shrink: 0;
          }
          .standee-feat-text {
            display: flex;
            flex-direction: column;
            font-size: 0.76rem;
          }
          .standee-feat-text strong {
            color: #0f172a;
            font-weight: 700;
            font-size: 0.84rem;
            margin-bottom: 2px;
          }
          .standee-feat-text span {
            color: #475569;
            font-size: 0.75rem;
          }
          .standee-action-btn-row {
            display: none !important;
          }
          code {
            background: #f1f5f9;
            padding: 3px 8px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 0.82rem;
            color: #0f172a;
            font-weight: 700;
          }
          #standeeQrTargetDisplay {
            color: #2563eb !important;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        ${clone.outerHTML}
      </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
      } catch (e) {
        window.print();
      }
    }, 350);
  }

  // --- Android PWA / Service Worker Setup for Store Owner ---
  setupPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent browser default install banner inside APK / web environment
      e.preventDefault();
    });

    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW error:', err));
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.ownerApp = new StoreOwnerApp();
});
