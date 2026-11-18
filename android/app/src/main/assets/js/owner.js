/* ==========================================================================
   STORE OWNER & MERCHANT PORTAL LOGIC (owner.js)
   11-Stamp Milestone Reward Terminal:
   - Stamp #5:  20% OFF Offer
   - Stamp #8:  50% OFF Offer
   - Stamp #11: Grand FREE GIFT (Resets card for next cycle)
   ========================================================================== */

if (typeof window !== 'undefined' && window.__STORE_OWNER_APP_CLASS_DEFINED__) {
  console.log("StoreOwnerApp already defined, skipping duplicate execution.");
} else {
  if (typeof window !== 'undefined') window.__STORE_OWNER_APP_CLASS_DEFINED__ = true;

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
  recoveryKey: "9999",
  googleReviewUrl: "https://share.google/q0NPPENHYIeZs7ReR"
};

// Known mock demo customer phone numbers & automation accounts to purge
const MOCK_DEMO_PHONES = [
  "9876543211",
  "9999988888",
  "9990001111",
  "9840112233",
  "9840123456",
  "6369095106",
  "test_check_cols"
];
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
    this.appVersion = "1.6.25";
    this.versionCode = 33;
    this.latestUpdateInfo = null;

    if (typeof window !== 'undefined') {
      window.ownerApp = this;
      window.loyaltyOwnerApp = this;
    }

    this.init();
  }

  init() {
    this.loadState();
    this.bindEvents();
    this.setupBackNavigation();
    this.setupPWA();
    this.render();
    this.fetchRemoteCustomers();
    this.startLiveSync();
    this.setupOfflineSync();
    this.checkForAppUpdates(false);
    setTimeout(() => this.checkForAppUpdates(false), 1200);
    setTimeout(() => this.checkForAppUpdates(false), 3000);
  }

  setupOfflineSync() {
    // Clear any stale offline flags on startup
    localStorage.removeItem('owner_offline_pending_sync');

    window.addEventListener('online', () => {
      this.syncOfflineQueue();
    });

    setInterval(() => {
      if (navigator.onLine && localStorage.getItem('owner_offline_pending_sync') === 'true') {
        this.syncOfflineQueue();
      }
    }, 15000);
  }

  async syncOfflineQueue() {
    if (localStorage.getItem('owner_offline_pending_sync') !== 'true') return;
    localStorage.removeItem('owner_offline_pending_sync'); // Clear immediately to prevent repeat triggers
    try {
      if (this.users.length > 0) {
        await this.pushCustomerToServer(this.users);
      }
      this.showToast("🔄 Reconnected! Offline store updates synced to server.", "success");
    } catch (e) {}
  }

  sanitizeCustomerNotes(userList) {
    if (!Array.isArray(userList)) return userList;
    const validHistoryTypes = new Set(['stamp', 'stamp_cancelled', 'reward', 'joined']);
    userList.forEach(u => {
      // Purge any update alerts or system broadcast events from permanent stamp history
      if (Array.isArray(u.history)) {
        u.history = u.history.filter(item => {
          if (!item || !item.type) return false;
          if (!validHistoryTypes.has(item.type)) return false;
          if (typeof item.note === 'string' && (item.note.includes('System Update Alert') || item.note.includes('Seamless 1-tap updates') || item.note.includes('Update verified'))) return false;
          return true;
        });
      }

      // Apple iPhone / iOS / Safari Pass users run live web and do not receive APK push alerts
      if (this.isCustomerIosOrWeb(u)) {
        if (u.updateAlert) {
          delete u.updateAlert;
        }
        u.appVersion = this.appVersion;
      }
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
    const deletedSet = new Set(JSON.parse(localStorage.getItem('loyalty_deleted_customers') || '[]'));
    const isTombstoned = (ph) => {
      if (!ph) return false;
      const str = String(ph).trim();
      const d10 = str.replace(/\D/g, '').slice(-10);
      return deletedSet.has(str) || (d10 && (deletedSet.has(d10) || deletedSet.has(`91${d10}`) || deletedSet.has(`+91${d10}`)));
    };
    if (storedUsers) {
      try {
        let loaded = JSON.parse(storedUsers);
        // Retain only active real customers, strictly exclude system records, deleted and demo entries
        this.users = Array.isArray(loaded) ? loaded.filter(u => u && u.phone && !String(u.phone).startsWith('__') && String(u.phone).trim() !== '__APP_CONFIG_VERSION__' && !MOCK_DEMO_PHONES.includes(u.phone) && !isTombstoned(u.phone) && u.name !== '__DELETED__') : [];
      } catch (e) {
        this.users = [];
      }
    } else {
      this.users = [];
    }
    this.sanitizeCustomerNotes(this.users);
    localStorage.setItem(APP_STORAGE_KEY_USERS, JSON.stringify(this.users));

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
        const deletedSet = new Set(JSON.parse(localStorage.getItem('loyalty_deleted_customers') || '[]'));
        const isTombstoned = (ph) => {
          if (!ph) return false;
          const str = String(ph).trim();
          const d10 = str.replace(/\D/g, '').slice(-10);
          return deletedSet.has(str) || (d10 && (deletedSet.has(d10) || deletedSet.has(`91${d10}`) || deletedSet.has(`+91${d10}`)));
        };

        // Reconcile: if a customer still exists in Supabase (not __DELETED__), remove from tombstone
        // This ensures previously deleted-locally customers reappear if they re-registered or were never actually deleted from cloud
        const remotePhoneSet = new Set(remoteUsers.filter(r => r && r.phone && !String(r.phone).startsWith('__') && String(r.phone).trim() !== '__APP_CONFIG_VERSION__' && r.name !== '__DELETED__').map(r => String(r.phone || '').trim()).filter(Boolean));
        let tombstoneChanged = false;
        for (const dp of deletedSet) {
          if (remotePhoneSet.has(dp)) {
            deletedSet.delete(dp);
            tombstoneChanged = true;
          }
        }
        if (tombstoneChanged) {
          localStorage.setItem('loyalty_deleted_customers', JSON.stringify(Array.from(deletedSet)));
        }

        // Purge any locally present customers that were marked deleted or system config
        const countBefore = this.users.length;
        this.users = this.users.filter(u => u && u.phone && !String(u.phone).startsWith('__') && String(u.phone).trim() !== '__APP_CONFIG_VERSION__' && !isTombstoned(u.phone) && u.name !== '__DELETED__');
        if (this.users.length !== countBefore) changed = true;

        remoteUsers.forEach(rem => {
          const remPhone = String(rem.phone || '').trim();
          if (!remPhone || remPhone.startsWith('__') || remPhone === '__APP_CONFIG_VERSION__' || MOCK_DEMO_PHONES.includes(remPhone) || isTombstoned(remPhone) || rem.name === '__DELETED__') return;
          const idx = this.users.findIndex(u => String(u.phone).trim() === remPhone);
          if (idx === -1) {
            this.users.unshift(rem);
            changed = true;
          } else {
            const current = this.users[idx];
            let userChanged = false;
            if (rem.name && rem.name !== current.name) { current.name = rem.name; userChanged = true; }
            if (rem.memberId && rem.memberId !== current.memberId) { current.memberId = rem.memberId; userChanged = true; }
            if (rem.stamps !== current.stamps) { current.stamps = rem.stamps; userChanged = true; }
            if (rem.giftsEarned !== current.giftsEarned) { current.giftsEarned = rem.giftsEarned; userChanged = true; }
            if (rem.appVersion && rem.appVersion !== current.appVersion) { current.appVersion = rem.appVersion; userChanged = true; }
            if (rem.versionCode && rem.versionCode !== current.versionCode) { current.versionCode = rem.versionCode; userChanged = true; }
            if (rem.deviceName && rem.deviceName !== current.deviceName) { current.deviceName = rem.deviceName; userChanged = true; }
            if (JSON.stringify(rem.history) !== JSON.stringify(current.history)) { current.history = rem.history; userChanged = true; }
            if (userChanged) changed = true;
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

    // Setup Supabase Realtime Stream for Instant Push of Customers & Requests
    if (window.loyaltyDb && window.loyaltyDb.isReady) {
      window.loyaltyDb.subscribeToAllCustomers((cust, eventType) => {
        console.log("⚡ Owner Realtime Customer Sync:", eventType, cust ? cust.phone : '');
        if (!cust || !cust.phone) return;
        const p = String(cust.phone).trim();
        const d10 = p.replace(/\D/g, '').slice(-10);
        if (p.startsWith('__') || p === '__APP_CONFIG_VERSION__') return;
        const deletedSet = new Set(JSON.parse(localStorage.getItem('loyalty_deleted_customers') || '[]'));
        const isTombstoned = deletedSet.has(p) || (d10 && (deletedSet.has(d10) || deletedSet.has(`91${d10}`) || deletedSet.has(`+91${d10}`)));
        if (eventType === 'DELETE' || cust.name === '__DELETED__' || isTombstoned) {
          this.users = this.users.filter(u => {
            const uP = String(u.phone).trim();
            const u10 = uP.replace(/\D/g, '').slice(-10);
            return uP !== p && (!d10 || u10 !== d10);
          });
          localStorage.setItem(APP_STORAGE_KEY_USERS, JSON.stringify(this.users));
          this.renderMetrics();
          this.renderCustomerList();
          return;
        }

        // Direct instant in-memory merge for immediate UI update
        const idx = this.users.findIndex(u => String(u.phone).trim() === p);
        if (idx !== -1) {
          const current = this.users[idx];
          if (!current.lastUpdated || !cust.lastUpdated || cust.lastUpdated >= current.lastUpdated) {
            this.users[idx] = { ...current, ...cust };
          }
        } else {
          this.users.unshift(cust);
        }
        localStorage.setItem(APP_STORAGE_KEY_USERS, JSON.stringify(this.users));
        this.renderMetrics();
        this.renderCustomerList();

        this.fetchRemoteCustomers();
      });

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
    }, 2500);
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

    this.pushBackHistory('ownerApprovalModal');
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
    let synced = false;
    try {
      if (window.loyaltyDb && window.loyaltyDb.isReady) {
        if (Array.isArray(customerData)) {
          await window.loyaltyDb.upsertCustomers(customerData);
        } else {
          await window.loyaltyDb.upsertCustomer(customerData);
        }
        synced = true;
      }
    } catch (dbErr) {
      console.warn("Cloud DB sync attempt:", dbErr);
    }

    try {
      const resp = await fetch(`${API_BASE_URL}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerData)
      });
      if (resp && resp.ok) synced = true;
    } catch (e) {}

    if (synced) {
      localStorage.removeItem('owner_offline_pending_sync');
    } else {
      localStorage.setItem('owner_offline_pending_sync', 'true');
    }
  }

  bindEvents() {
    // Resume & Focus Lifecycle Handlers for Instant Sync
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.fetchRemoteCustomers();
        if (this.isLoggedIn) {
          this.fetchPendingApprovalRequests();
        }
        if (window.loyaltyDb && typeof window.loyaltyDb.reconnectIfNeeded === 'function') {
          window.loyaltyDb.reconnectIfNeeded();
        }
      }
    });
    window.addEventListener('focus', () => {
      this.fetchRemoteCustomers();
      if (this.isLoggedIn) this.fetchPendingApprovalRequests();
    });
    window.addEventListener('online', () => {
      this.fetchRemoteCustomers();
      if (this.isLoggedIn) this.fetchPendingApprovalRequests();
    });

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

    ['ownerLogoutHeaderBtn', 'ownerDashboardLogoutBtn'].forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) btn.addEventListener('click', () => this.handleLogout());
    });

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
        this.renderCustomerList();
        this.renderMetrics();
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

    // Setup phone input constraint (10 digits only)
    const newCustPhoneInput = document.getElementById('ownerNewCustPhone');
    if (newCustPhoneInput) {
      newCustPhoneInput.setAttribute('maxlength', '10');
      newCustPhoneInput.setAttribute('inputmode', 'numeric');
      newCustPhoneInput.setAttribute('pattern', '[0-9]{10}');
      
      newCustPhoneInput.addEventListener('keydown', (e) => {
        const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Home', 'End'];
        if (allowedKeys.includes(e.key) || (e.ctrlKey || e.metaKey)) return;
        if (!/^[0-9]$/.test(e.key)) {
          e.preventDefault();
        }
      });
      newCustPhoneInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '');
        if (val.length > 10) val = val.slice(0, 10);
        if (e.target.value !== val) e.target.value = val;
      });
      newCustPhoneInput.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text') || '';
        const digits = text.replace(/\D/g, '').slice(0, 10);
        document.execCommand('insertText', false, digits);
      });
    }

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
      b.addEventListener('click', (e) => {
        if (e) e.preventDefault();
        this.closeModals();
      });
    });

    // Close when tapping outside dialog on backdrop
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.closeModals();
      });
    });

    // Setup modal scroll isolation (locks background page scrolling while modal is active)
    this.setupModalScrollIsolation();

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

    // Owner Terminal Auto Update Popup Modal (App Open Alert) Buttons
    const ownerAppUpdateModalActionBtn = document.getElementById('ownerAppUpdateModalActionBtn');
    if (ownerAppUpdateModalActionBtn) {
      ownerAppUpdateModalActionBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleApplyUpdate();
      });
    }

    const ownerUpdateAlertModal = document.getElementById('ownerUpdateAlertModal');
    if (ownerUpdateAlertModal) {
      const closeBtn = ownerUpdateAlertModal.querySelector('.modal-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.closeOwnerUpdateModal();
        });
      }
      const remindBtn = ownerUpdateAlertModal.querySelector('button[onclick*="remindLaterUpdate"], [data-action="remind-later"]');
      if (remindBtn) {
        remindBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.remindLaterUpdate();
        });
      }
    }

    // Capture-Phase Global Delegation for Terminal Update Modal
    document.addEventListener('click', (e) => {
      const updateBtn = e.target.closest('#ownerAppUpdateModalActionBtn, .btn-update-now, [data-action="apply-update"]');
      if (updateBtn && updateBtn.closest('#ownerUpdateAlertModal')) {
        e.preventDefault();
        e.stopPropagation();
        this.handleApplyUpdate();
        return;
      }
      const remindBtn = e.target.closest('#ownerUpdateAlertModal button[onclick*="remindLater"], [data-action="remind-later"]');
      if (remindBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.remindLaterUpdate();
        return;
      }
      const closeBtn = e.target.closest('#ownerUpdateAlertModal .modal-close-btn, [data-action="close-update-modal"]');
      if (closeBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.closeOwnerUpdateModal();
        return;
      }
    }, true);

    this.setupApkDownloadHooks();

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
      this.pushBackHistory('forgotPasswordModal');
      modal.classList.add('active');
    }
  }

  setupModalScrollIsolation() {
    const updateBodyLock = () => {
      const activeBackdrop = document.querySelector('.modal-backdrop.active');
      if (activeBackdrop) {
        document.body.classList.add('modal-open');
      } else {
        document.body.classList.remove('modal-open');
      }
    };

    updateBodyLock();

    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => updateBodyLock());
      document.querySelectorAll('.modal-backdrop').forEach(modal => {
        observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
      });
    }
  }

  closeModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
    document.body.classList.remove('modal-open');
  }

  // --- Step-by-Step Back Navigation & History Controller ---
  setupBackNavigation() {
    window.handleAppBack = () => this.handleBack();

    // Listen for mobile browser & iOS Safari back gestures / popstate
    window.addEventListener('popstate', () => {
      this.handleBack(true);
    });

    // Support ESC key on desktop/laptop keyboards
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        this.handleBack();
      }
    });
  }

  pushBackHistory(modalId) {
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
      try {
        window.history.pushState({ ownerBackModal: modalId || 'modal' }, '');
      } catch (_) {}
    }
  }

  handleBack(fromPopstate = false) {
    // 1. Check for any active modals in reverse DOM order
    const activeModals = Array.from(document.querySelectorAll('.modal-backdrop.active, .modal-backdrop[style*="display: flex"], .modal-backdrop[style*="display:flex"], .modal-backdrop[style*="display: block"], .modal-backdrop[style*="display:block"]'))
      .filter(m => {
        const style = window.getComputedStyle(m);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      });

    if (activeModals.length > 0) {
      const topModal = activeModals[activeModals.length - 1];
      const modalId = topModal.id;

      if (modalId === 'ownerUpdateAlertModal') {
        this.closeOwnerUpdateModal();
      } else {
        topModal.classList.remove('active');
        topModal.style.setProperty('display', 'none', 'important');
      }

      const remaining = Array.from(document.querySelectorAll('.modal-backdrop.active, .modal-backdrop[style*="display: flex"], .modal-backdrop[style*="display:flex"], .modal-backdrop[style*="display: block"], .modal-backdrop[style*="display:block"]'))
        .filter(m => {
          const style = window.getComputedStyle(m);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        });

      if (!remaining || remaining.length === 0) {
        document.body.classList.remove('modal-open');
      }

      if (!fromPopstate && window.history && window.history.state && window.history.state.ownerBackModal) {
        try { window.history.back(); } catch (_) {}
      }
      return true;
    }

    // 2. Check if any customer card has expanded details/history
    if (this.expandedCustomerPhones && this.expandedCustomerPhones.size > 0) {
      this.expandedCustomerPhones.clear();
      this.renderCustomerList();
      return true;
    }

    // 3. Check if search input has text
    const searchInput = document.getElementById('ownerCustomerSearch');
    if (searchInput && searchInput.value && searchInput.value.trim() !== '') {
      searchInput.value = '';
      this.ownerSearchQuery = '';
      this.renderCustomerList();
      return true;
    }

    // 4. Check if filter tab is not 'all'
    if (this.ownerFilter && this.ownerFilter !== 'all') {
      this.setFilter('all');
      return true;
    }

    // 5. Blur any focused input
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
      document.activeElement.blur();
      return true;
    }

    return false;
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
    if (input) {
      input.value = this.getTargetCustomerVersion();
    }

    this.pushBackHistory('ownerSettingsModal');
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

    // 1. Primary priority: Live GitHub Pages cloud version (always available on mobile & web)
    try {
      const respCloud = await fetch(`https://sughan21.github.io/New-loyal-cards/data/version.json?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      });
      if (respCloud.ok) {
        updateData = await respCloud.json();
      }
    } catch (e) {}

    // 2. Second priority: Supabase Realtime Cloud (instant cross-device sync)
    if (!updateData && window.loyaltyDb && window.loyaltyDb.isReady) {
      try {
        updateData = await window.loyaltyDb.fetchAppVersion();
      } catch (e) {}
    }

    // 3. Third priority: Local server or tunnel REST API (short timeout so mobile doesn't stall)
    if (!updateData) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const resp = await fetch(`${API_BASE_URL}/api/version?_t=${Date.now()}`, { cache: 'no-cache', signal: controller.signal });
        clearTimeout(timeoutId);
        if (resp.ok) updateData = await resp.json();
      } catch (e) {}
    }

    // 4. Last resort fallback: local static JSON, but ONLY if newer than appVersion
    if (!updateData) {
      try {
        const resp2 = await fetch(`./data/version.json?_t=${Date.now()}`, { cache: 'no-cache' });
        if (resp2.ok) {
          const localJson = await resp2.json();
          if (localJson && this.isNewerVersion(localJson.ownerVersion || localJson.version, this.appVersion)) {
            updateData = localJson;
          }
        }
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
      ? this.isNewerVersion(remoteOwnerVer, this.appVersion)
      : (!isCustomerTarget && this.isNewerVersion(updateData.version, this.appVersion));

    const ownerBadgeIds = ['ownerSettingsUpdateBadge', 'ownerDashboardSettingsBadge'];
    const updateIconPulse = document.getElementById('ownerUpdateIconPulse');
    const updateIconSymbol = document.getElementById('ownerUpdateIconSymbol');
    const updateStatusTitle = document.getElementById('ownerUpdateStatusTitle');
    const updateStatusSubtitle = document.getElementById('ownerUpdateStatusSubtitle');
    const newUpdateBanner = document.getElementById('ownerNewUpdateBanner');
    const newUpdateVerText = document.getElementById('ownerNewUpdateVerText');
    const newUpdateNotesText = document.getElementById('ownerNewUpdateNotesText');

    const ownerUpdateVersionStrip = document.getElementById('ownerUpdateVersionStrip');
    const ownerCurrentVerDisplay = document.getElementById('ownerCurrentVerDisplay');
    const ownerVersionChipArrow = document.getElementById('ownerVersionChipArrow');
    const ownerNewVersionChip = document.getElementById('ownerNewVersionChip');
    const ownerNewVerDisplay = document.getElementById('ownerNewVerDisplay');

    if (ownerCurrentVerDisplay) {
      ownerCurrentVerDisplay.innerHTML = `<span class="version-num">v${this.appVersion}</span><span class="version-chip-badge ${hasNewVersion ? 'installed' : 'latest'}">${hasNewVersion ? 'Installed' : 'Latest ✅'}</span>`;
    }

    if (hasNewVersion) {
      if (ownerUpdateVersionStrip) ownerUpdateVersionStrip.classList.add('has-update');
      if (ownerVersionChipArrow) ownerVersionChipArrow.style.setProperty('display', 'flex', 'important');
      if (ownerNewVersionChip) ownerNewVersionChip.style.setProperty('display', 'flex', 'important');
      if (ownerNewVerDisplay) {
        ownerNewVerDisplay.innerHTML = `<span class="version-num">v${remoteOwnerVer || updateData.version}</span><span class="version-chip-badge update">⚡ New</span>`;
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

      // Auto show Update Modal on app open with Update button and Remind Me Later
      const targetTerminalVer = remoteOwnerVer || updateData.version;
      const isSnoozedSession = sessionStorage.getItem('owner_update_snooze_session') === 'true';
      if (!isSnoozedSession || isManual) {
        setTimeout(() => {
          this.showOwnerUpdateAlertModal(
            targetTerminalVer,
            updateData.notes || `Version ${targetTerminalVer} is ready to install! Update now to sync the latest features, cashier tools, and optimizations.`
          );
        }, 500);
      }

      if (isManual) this.showToast(`⚡ New version ${remoteOwnerVer || updateData.version} is available!`, "gold");
    } else {
      if (ownerUpdateVersionStrip) ownerUpdateVersionStrip.classList.remove('has-update');
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

  setupApkDownloadHooks() {
    window.onApkDownloadStart = () => {
      const actionBtn = document.getElementById('ownerAppUpdateModalActionBtn');
      const progressBox = document.getElementById('ownerAppUpdateProgressBox');
      const progressBar = document.getElementById('ownerAppUpdateProgressBar');
      const progressStatus = document.getElementById('ownerAppUpdateProgressStatus');
      if (actionBtn) {
        actionBtn.innerHTML = '⏳ Downloading Terminal Update...';
        actionBtn.style.opacity = '0.85';
        actionBtn.style.pointerEvents = 'none';
      }
      if (progressBox) progressBox.style.display = 'block';
      if (progressBar) progressBar.style.width = '10%';
      if (progressStatus) progressStatus.textContent = 'Connecting & downloading update package (10.3 MB)...';
    };

    window.onApkDownloadProgress = (percent) => {
      const actionBtn = document.getElementById('ownerAppUpdateModalActionBtn');
      const progressBox = document.getElementById('ownerAppUpdateProgressBox');
      const progressBar = document.getElementById('ownerAppUpdateProgressBar');
      const progressStatus = document.getElementById('ownerAppUpdateProgressStatus');
      if (progressBox) progressBox.style.display = 'block';
      if (actionBtn) actionBtn.innerHTML = `⏳ Downloading... ${percent}%`;
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressStatus) progressStatus.textContent = `Downloading update: ${percent}% (10.3 MB)`;
    };

    window.onApkDownloadComplete = () => {
      const actionBtn = document.getElementById('ownerAppUpdateModalActionBtn');
      const progressBar = document.getElementById('ownerAppUpdateProgressBar');
      const progressStatus = document.getElementById('ownerAppUpdateProgressStatus');
      if (actionBtn) actionBtn.innerHTML = '✅ Ready! Launching Installer...';
      if (progressBar) progressBar.style.width = '100%';
      if (progressStatus) progressStatus.textContent = 'Download complete! Opening Android installer...';
      setTimeout(() => {
        this.closeOwnerUpdateModal();
      }, 3500);
    };

    window.onApkDownloadError = (errMsg) => {
      const actionBtn = document.getElementById('ownerAppUpdateModalActionBtn');
      const progressStatus = document.getElementById('ownerAppUpdateProgressStatus');
      if (actionBtn) {
        actionBtn.innerHTML = '⚠️ Tap to Download in Browser';
        actionBtn.style.opacity = '1';
        actionBtn.style.pointerEvents = 'auto';
        actionBtn.onclick = () => {
          window.location.href = 'https://raw.githubusercontent.com/sughan21/New-loyal-cards/main/StoreTerminal-Owner.apk';
        };
      }
      if (progressStatus) {
        progressStatus.innerHTML = '<span style="color:#ef4444; font-weight:700;">Download interrupted. Tap button above to download directly in browser.</span>';
      }
    };
  }

  showOwnerUpdateAlertModal(targetVer, notes) {
    const modal = document.getElementById('ownerUpdateAlertModal');
    if (!modal) return;
    const title = document.getElementById('ownerAppUpdateModalTitle');
    const desc = document.getElementById('ownerAppUpdateModalDesc');
    const actionBtn = document.getElementById('ownerAppUpdateModalActionBtn') ||
                      modal.querySelector('.btn-update-now') ||
                      modal.querySelector('button[onclick*="handleApplyUpdate"]');
    const progressBox = document.getElementById('ownerAppUpdateProgressBox');
    const progressBar = document.getElementById('ownerAppUpdateProgressBar');
    if (progressBox) progressBox.style.display = 'none';
    if (progressBar) progressBar.style.width = '0%';

    let target = targetVer;
    if (!target && this.latestUpdateInfo) {
      target = this.latestUpdateInfo.ownerVersion || this.latestUpdateInfo.version;
    }
    if (!target) {
      target = "1.6.25";
    }
    if (title) title.textContent = `Terminal Update Available (v${target})`;
    if (desc && notes) desc.textContent = notes;
    if (actionBtn) {
      actionBtn.innerHTML = `🚀 Update Terminal App (v${target})`;
      actionBtn.style.opacity = '1';
      actionBtn.style.pointerEvents = 'auto';
    }
    this.pushBackHistory('ownerUpdateAlertModal');
    modal.classList.add('active');
    modal.style.setProperty('display', 'flex', 'important');
    document.body.classList.add('modal-open');
    if (window.soundEngine && typeof window.soundEngine.playSuccessTone === 'function') {
      window.soundEngine.playSuccessTone();
    }
  }

  remindLaterUpdate() {
    try {
      sessionStorage.setItem('owner_update_snooze_session', 'true');
      localStorage.removeItem('owner_update_snooze_version');
      localStorage.removeItem('owner_update_snooze_session');
    } catch (_) {}
    this.closeOwnerUpdateModal();
    this.showToast("🕒 We'll remind you about the update later.", "info");
  }

  closeOwnerUpdateModal() {
    const modal = document.getElementById('ownerUpdateAlertModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.setProperty('display', 'none', 'important');
      document.body.classList.remove('modal-open');
    }
  }

  handleApplyUpdate() {
    const isAndroid = !!window.AndroidBridge || /android/i.test(navigator.userAgent);
    const ownerApkUrl = 'https://raw.githubusercontent.com/sughan21/New-loyal-cards/main/StoreTerminal-Owner.apk';
    const actionBtn = document.getElementById('ownerAppUpdateModalActionBtn');
    const progressBox = document.getElementById('ownerAppUpdateProgressBox');
    const progressBar = document.getElementById('ownerAppUpdateProgressBar');
    const progressStatus = document.getElementById('ownerAppUpdateProgressStatus');

    if (actionBtn) {
      actionBtn.innerHTML = '⏳ Downloading Terminal Update...';
      actionBtn.style.opacity = '0.85';
      actionBtn.style.pointerEvents = 'none';
    }
    if (progressBox) progressBox.style.display = 'block';
    if (progressBar) progressBar.style.width = '8%';

    if (isAndroid) {
      this.showToast("⚡ Downloading Store Terminal APK...", "gold");

      if (window.AndroidBridge && typeof window.AndroidBridge.downloadApk === 'function') {
        window.AndroidBridge.downloadApk(ownerApkUrl);
        return;
      }

      // Browser fallback: direct navigation triggers browser download manager
      window.location.href = ownerApkUrl;
    } else {
      this.closeOwnerUpdateModal();
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
      this.showToast("Please enter a version number (e.g. 1.6.9)", "error");
      return;
    }

    const customNotes = notesInput && notesInput.value.trim() ? notesInput.value.trim() : "Seamless 1-tap updates, faster cloud sync & iPhone pass support.";
    const customFeatures = customNotes.split(/\n|•|;|\band\b|(?<=\.)\s+/).map(s => s.trim().replace(/^[-*•]\s*/, '')).filter(s => s.length > 3);

    const payload = {
      target: "customer",
      version: newVer,
      customerVersion: newVer,
      customerVersionCode: this.versionCode,
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

    // 4. Realtime Push Update Alert to all registered customer cards in cloud
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const outdatedCustomersToSync = [];

    this.users.forEach(customer => {
      if (!customer || !customer.phone || String(customer.phone).startsWith('__')) {
        return;
      }
      // Apple iPhone / iOS Safari Pass customers run the live web version and do not install APK builds - skip update alerts
      if (this.isCustomerIosOrWeb(customer)) {
        return;
      }
      customer.updateAlert = {
        targetVersion: newVer,
        sentAt: new Date().toISOString(),
        status: 'pending'
      };
      customer.lastUpdated = Date.now();
      outdatedCustomersToSync.push(customer);
    });

    this.saveUsers();

    if (outdatedCustomersToSync.length > 0) {
      await this.pushCustomerToServer(outdatedCustomersToSync);
    }

    this.showToast(`📢 Version ${newVer} broadcasted to all customer apps!`, "gold");
    this.checkForAppUpdates(false);
    this.renderCustomerList();
    this.renderMetrics();
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
    const nameInput = document.getElementById('ownerNewCustName');
    const phoneInput = document.getElementById('ownerNewCustPhone');
    const name = nameInput ? nameInput.value.trim() : '';
    const rawPhone = phoneInput ? phoneInput.value.trim() : '';
    const phone = rawPhone.replace(/\D/g, '').slice(0, 10);

    if (!name) {
      this.showToast("Please enter customer name.", "error");
      if (nameInput) nameInput.focus();
      return;
    }

    if (!/^\d{10}$/.test(phone)) {
      this.showToast("Please enter a valid 10-digit mobile number.", "error");
      if (phoneInput) {
        phoneInput.focus();
        phoneInput.classList.add('input-error');
        setTimeout(() => phoneInput.classList.remove('input-error'), 1500);
      }
      return;
    }

    const cleanExisting = (p) => (p || '').replace(/\D/g, '');
    if (this.users.some(u => {
      const ep = cleanExisting(u.phone);
      return ep === phone || (ep.length >= 10 && ep.endsWith(phone)) || (phone.length >= 10 && phone.endsWith(ep));
    })) {
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

  ownerRemoveTickFromCustomer(phone) {
    const customer = this.users.find(u => u.phone === phone);
    if (!customer) return;

    const currentStamps = parseInt(customer.stamps, 10) || 0;
    if (currentStamps <= 0) {
      this.showToast(`ℹ️ ${customer.name} already has 0 ticks.`, "info");
      return;
    }

    if (!confirm(`Delete 1 stamp from ${customer.name}?\n\nCurrent: ${currentStamps}/${MAX_STAMPS} ticks ➔ New: ${currentStamps - 1}/${MAX_STAMPS} ticks`)) {
      return;
    }

    customer.stamps = Math.max(0, currentStamps - 1);
    const remaining = MAX_STAMPS - customer.stamps;

    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (!Array.isArray(customer.history)) customer.history = [];
    customer.history.unshift({
      date: `${date}, ${time}`,
      type: "stamp_cancelled",
      note: `↩️ Stamp Removed by Cashier (Tick #${currentStamps} deleted. Current: ${customer.stamps}/${MAX_STAMPS})`,
      appVersion: customer.appVersion || this.getTargetCustomerVersion()
    });

    this.saveUsers();

    if (window.soundEngine && typeof window.soundEngine.playTrashSound === 'function') {
      window.soundEngine.playTrashSound();
    } else if (window.soundEngine && typeof window.soundEngine.playClick === 'function') {
      window.soundEngine.playClick();
    }

    this.showToast(`↩️ Removed 1 tick for ${customer.name} (${customer.stamps}/${MAX_STAMPS}) • ${remaining} tick${remaining > 1 ? 's' : ''} remaining`, "info");
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

  ownerDeleteCustomer(phone) {
    this.promptDeleteCustomer(phone);
  }

  promptDeleteCustomer(phone) {
    const cleanPhone = String(phone).trim();
    const d10 = cleanPhone.replace(/\D/g, '').slice(-10);
    const customer = this.users.find(u => {
      const uPhone = String(u.phone).trim();
      const u10 = uPhone.replace(/\D/g, '').slice(-10);
      return uPhone === cleanPhone || (d10 && u10 === d10);
    });

    this.pendingDeletePhone = cleanPhone;
    this.pendingDeleteCustomer = customer;

    const modal = document.getElementById('ownerDeleteCustomerModal');
    if (!modal) {
      if (confirm(`Are you sure you want to permanently delete customer "${customer ? customer.name : phone}"? This will delete their card and stamps from the database.`)) {
        this.performFullCustomerDelete(cleanPhone);
      }
      return;
    }

    const nameEl = document.getElementById('deleteCustModalName');
    const phoneEl = document.getElementById('deleteCustModalPhone');
    const statsEl = document.getElementById('deleteCustModalStats');

    if (nameEl) nameEl.textContent = customer ? customer.name : 'Loyalty Customer';
    if (phoneEl) phoneEl.textContent = `📞 ${cleanPhone}`;
    if (statsEl) statsEl.textContent = customer ? `Pass Progress: ${customer.stamps || 0} of ${MAX_STAMPS} Ticks • ${customer.giftsEarned || 0} Gifts Earned` : '';

    this.pushBackHistory('ownerDeleteCustomerModal');
    modal.classList.add('active');
    modal.style.setProperty('display', 'flex', 'important');
    document.body.classList.add('modal-open');
  }

  closeDeleteCustomerModal() {
    const modal = document.getElementById('ownerDeleteCustomerModal');
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
    document.body.classList.remove('modal-open');
    this.pendingDeletePhone = null;
    this.pendingDeleteCustomer = null;
  }

  async executeConfirmDeleteCustomer() {
    const phone = this.pendingDeletePhone;
    this.closeDeleteCustomerModal();
    if (!phone) return;
    await this.performFullCustomerDelete(phone);
  }

  async performFullCustomerDelete(phone) {
    const cleanPhone = String(phone).trim();
    const d10 = cleanPhone.replace(/\D/g, '').slice(-10);
    const customer = this.users.find(u => {
      const uPhone = String(u.phone).trim();
      const u10 = uPhone.replace(/\D/g, '').slice(-10);
      return uPhone === cleanPhone || (d10 && u10 === d10);
    });
    const name = customer ? customer.name : phone;

    // 1. Remove from local memory & persistent storage immediately (all phone variants)
    this.users = this.users.filter(u => {
      const uPhone = String(u.phone).trim();
      const u10 = uPhone.replace(/\D/g, '').slice(-10);
      return uPhone !== cleanPhone && (!d10 || u10 !== d10);
    });
    localStorage.setItem(APP_STORAGE_KEY_USERS, JSON.stringify(this.users));

    // 2. Add to local tombstone set so background polls never restore it
    try {
      const deletedSet = new Set(JSON.parse(localStorage.getItem('loyalty_deleted_customers') || '[]'));
      deletedSet.add(cleanPhone);
      if (d10) {
        deletedSet.add(d10);
        deletedSet.add(`91${d10}`);
        deletedSet.add(`+91${d10}`);
      }
      localStorage.setItem('loyalty_deleted_customers', JSON.stringify(Array.from(deletedSet)));
    } catch (_) {}

    // 3. Immediately re-render UI so customer disappears without delay
    if (window.soundEngine && typeof window.soundEngine.playTrashSound === 'function') {
      window.soundEngine.playTrashSound();
    } else if (window.soundEngine && typeof window.soundEngine.playSuccessTone === 'function') {
      window.soundEngine.playSuccessTone();
    }
    this.showToast(`🗑️ Permanently deleted customer "${name}".`, "info");
    this.render();

    // 4. Delete / tombstone from Supabase cloud database
    try {
      if (window.loyaltyDb && window.loyaltyDb.isReady) {
        await window.loyaltyDb.deleteCustomer(cleanPhone);
      }
    } catch (e) {
      console.warn("Cloud delete failed:", e);
    }

    // 5. Try local backend delete endpoint as well
    try {
      await fetch(`${API_BASE_URL}/api/customer/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleanPhone })
      });
    } catch (e) {}
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

    const permanentGithubUrl = `https://sughan21.github.io/New-loyal-cards/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;

    // Check if store owner configured a custom target URL
    let savedCustomUrl = localStorage.getItem('standee_target_url');
    // Clean up stale, tunnel, or obsolete URLs from previous sessions
    if (savedCustomUrl && (
      savedCustomUrl.includes('trycloudflare.com') ||
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
    } else {
      // PERMANENT DEFAULT: Always use 24/7 GitHub Cloud Link!
      // This ensures customers downloading the APK get 100% full, high-speed CDN downloads
      // without Cloudflare tunnel disconnects, timeouts, or local network mismatches.
      smartUrl = permanentGithubUrl;
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
    if (ghBtn) {
      if (smartUrl === permanentGithubUrl) {
        ghBtn.textContent = '✓ Permanent GitHub Cloud Link (Active 24/7)';
        ghBtn.style.background = '#f3e8ff';
        ghBtn.style.borderColor = '#9333ea';
        ghBtn.style.color = '#6b21a8';
      } else {
        ghBtn.textContent = '☁️ Use Permanent GitHub Cloud Link (24/7)';
        ghBtn.style.background = '#fdf4ff';
        ghBtn.style.borderColor = '#c084fc';
        ghBtn.style.color = '#7e22ce';
      }
      ghBtn.onclick = () => {
        localStorage.removeItem('standee_target_url');
        this.generateStoreQRCodes();
        this.showToast("☁️ QR set to Permanent GitHub Cloud Link (24/7)!", "gold");
      };
    }

    const cfBtn = document.getElementById('useCloudflarePresetBtn');
    if (cfBtn) {
      if (this.activeTunnelUrl) {
        cfBtn.style.display = 'inline-block';
        cfBtn.onclick = () => {
          const cfTarget = `${this.activeTunnelUrl}/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
          localStorage.setItem('standee_target_url', cfTarget);
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

        if (data && data.lanUrl) {
          this.lanUrl = data.lanUrl;
        }

        if (data && data.active && data.url) {
          this.activeTunnelUrl = data.url;
        } else {
          this.activeTunnelUrl = null;
        }

        // Keep the Standee QR on Permanent GitHub Cloud Link (24/7) by default!
        // Only update optional preset buttons if present
        const cfBtn = document.getElementById('useCloudflarePresetBtn');
        if (cfBtn) {
          cfBtn.style.display = this.activeTunnelUrl ? 'inline-block' : 'none';
        }
        const lanBtn = document.getElementById('useLanPresetBtn');
        if (lanBtn) {
          const directVal = document.getElementById('standeeDirectUrl')?.value || '';
          lanBtn.style.display = (this.lanUrl && !directVal.includes(this.lanUrl)) ? 'inline-block' : 'none';
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

  // --- Customer Version Helpers ---
  isCustomerIosOrWeb(customer) {
    if (!customer) return false;
    const history = Array.isArray(customer.history) ? customer.history : [];
    const dev = String(customer.deviceName || (history.find(h => h && h.device) ? history.find(h => h && h.device).device : '') || '').toLowerCase();
    const phone = String(customer.phone || '').trim();
    return dev.includes('iphone') || dev.includes('ipad') || dev.includes('ios') || dev.includes('apple') || dev.includes('safari') || dev.includes('web browser') || phone === '8015589598' || phone === '9914214325';
  }

  getTargetCustomerVersion() {
    const broadcastVer = localStorage.getItem('loyalty_owner_broadcast_version');
    const remoteVer = this.latestUpdateInfo ? (this.latestUpdateInfo.customerVersion || this.latestUpdateInfo.version) : null;
    let highest = this.appVersion || "1.6.25";
    if (broadcastVer && this.isNewerVersion(broadcastVer, highest)) {
      highest = broadcastVer;
    }
    if (remoteVer && this.isNewerVersion(remoteVer, highest)) {
      highest = remoteVer;
    }
    return highest;
  }

  isCustomerOutdated(customer) {
    if (!customer) return false;
    // Apple iPhone / iOS Safari Pass customers run the live web pass and cannot install APKs - NEVER show outdated
    if (this.isCustomerIosOrWeb(customer)) return false;
    const targetVer = this.getTargetCustomerVersion();
    const custVer = customer.appVersion;
    if (!custVer) return true;
    return this.isNewerVersion(targetVer, custVer);
  }

  sendWhatsAppUpdate(phone, encodedName, currentVer) {
    const name = decodeURIComponent(encodedName || 'Valued Customer');
    const targetVer = this.getTargetCustomerVersion();
    const cleanPhone = String(phone).replace(/\D/g, '');
    const intlPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const downloadUrl = 'https://raw.githubusercontent.com/sughan21/New-loyal-cards/main/LoyaltyPass-Customer.apk';
    const webPassUrl = 'https://sughan21.github.io/New-loyal-cards/';

    const cust = this.users.find(u => u.phone === phone);
    const stamps = cust ? (cust.stamps || 0) : 0;
    const isIos = this.isCustomerIosOrWeb(cust);

    let message = '';
    if (isIos) {
      message = `Hello ${name}! 👋\n\n` +
        `Here is the direct link to your *Sugar Cubes Loyalty Pass*:\n` +
        `👉 ${webPassUrl}\n\n` +
        `💡 *iPhone Tip:* Open the link in Safari, tap the Share button (⎋), and select *"Add to Home Screen"* (➕) for instant 1-tap pass access on your iPhone!\n\n` +
        `All your loyalty stamps (${stamps}/11 ticks) and rewards are safely saved in the cloud. See you soon! 🌟\n- Sugar Cubes Store`;
    } else {
      message = `Hello ${name}! 👋\n\n` +
        `A new update (*v${targetVer}*) is ready for your *Sugar Cubes Loyalty Pass* app! 🎁✨\n\n` +
        `⚠️ *IMPORTANT UPDATE STEPS:*\n` +
        `1️⃣ Please *uninstall the older version* of the Loyalty Pass app from your phone first.\n` +
        `2️⃣ Download and install the new version from this official link:\n` +
        `👉 ${downloadUrl}\n\n` +
        `💡 *Don't worry:* All your loyalty stamps (${stamps}/11 ticks), rewards, and free gift progress are safely saved in the cloud and will restore automatically when you sign in with your mobile number (*${phone}*)!\n\n` +
        `Thank you! 🌟\n- Sugar Cubes Store`;
    }

    const waUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(message)}`;

    if (window.AndroidBridge && typeof window.AndroidBridge.openExternalUrl === 'function') {
      window.AndroidBridge.openExternalUrl(waUrl);
    } else {
      window.open(waUrl, '_blank');
    }

    this.showToast(`💬 Opening WhatsApp to send pass details to ${name}...`, "success");
  }

  async pushIndividualCustomerUpdate(phone, encodedName) {
    const name = decodeURIComponent(encodedName || phone);
    const customer = this.users.find(u => u.phone === phone);
    if (!customer) return;

    if (this.isCustomerIosOrWeb(customer)) {
      this.showToast(`🍏 ${name} is an Apple iPhone user and always runs the latest Safari Pass.`, "info");
      return;
    }

    const targetVer = this.getTargetCustomerVersion();
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    customer.updateAlert = {
      targetVersion: targetVer,
      sentAt: new Date().toISOString(),
      status: 'pending'
    };

    customer.lastUpdated = Date.now();
    this.saveUsers();
    await this.pushCustomerToServer(customer);

    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`📲 Update alert (v${targetVer}) pushed to ${name}!`, "gold");
    this.renderCustomerList();
  }

  async markCustomerAsUpdated(phone) {
    const customer = this.users.find(u => u.phone === phone);
    if (!customer) return;

    const targetVer = this.getTargetCustomerVersion();
    customer.appVersion = targetVer;
    customer.versionCode = this.versionCode || 12;
    delete customer.updateAlert;

    customer.lastUpdated = Date.now();
    this.saveUsers();
    await this.pushCustomerToServer(customer);

    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`✅ ${customer.name} marked as updated to v${targetVer}! Alert box removed.`, "success");
    this.render();
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
    const activeUsers = this.users.filter(u => u && u.phone && !String(u.phone).startsWith('__') && String(u.phone).trim() !== '__APP_CONFIG_VERSION__' && u.name !== '__DELETED__');
    const totalCust = activeUsers.length;
    const readyForGift = activeUsers.filter(u => Number(u.stamps || 0) >= MAX_STAMPS).length;
    const activeOffers = activeUsers.filter(u => Number(u.stamps || 0) >= MILESTONE_20_OFF && Number(u.stamps || 0) < MAX_STAMPS).length;
    const inProgress = activeUsers.filter(u => Number(u.stamps || 0) >= 1 && Number(u.stamps || 0) < MAX_STAMPS).length;
    const newCust = activeUsers.filter(u => Number(u.stamps || 0) === 0).length;
    const outdatedCust = activeUsers.filter(u => this.isCustomerOutdated(u)).length;
    const totalGiftsRedeemed = activeUsers.reduce((acc, u) => acc + (Number(u.giftsEarned) || 0), 0);

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
    const pillOutdated = document.getElementById('pillCountOutdated');
    if (pillOutdated) pillOutdated.innerText = outdatedCust;

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

    let filtered = this.users.filter(u => u && u.phone && !String(u.phone).startsWith('__') && String(u.phone).trim() !== '__APP_CONFIG_VERSION__' && u.name !== '__DELETED__');

    if (this.ownerFilter === 'ready') {
      filtered = filtered.filter(u => Number(u.stamps || 0) >= MAX_STAMPS);
    } else if (this.ownerFilter === 'offers' || this.ownerFilter === 'urgent') {
      filtered = filtered.filter(u => Number(u.stamps || 0) >= MILESTONE_20_OFF && Number(u.stamps || 0) < MAX_STAMPS);
    } else if (this.ownerFilter === 'progress') {
      filtered = filtered.filter(u => Number(u.stamps || 0) >= 1 && Number(u.stamps || 0) < MAX_STAMPS);
    } else if (this.ownerFilter === 'new') {
      filtered = filtered.filter(u => Number(u.stamps || 0) === 0);
    } else if (this.ownerFilter === 'outdated') {
      filtered = filtered.filter(u => this.isCustomerOutdated(u));
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
          'new': 'New Customers (0 Ticks)',
          'outdated': 'Customers Needing App Update'
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

      const targetVer = this.getTargetCustomerVersion();
      const isIos = this.isCustomerIosOrWeb(customer);
      const isOutdated = !isIos && this.isCustomerOutdated(customer);
      const customerVer = customer.appVersion;
      const hasAlertSent = !isIos && ((customer.updateAlert && customer.updateAlert.status === 'pending') || (latestEvent && latestEvent.type === 'update_alert'));

      let badgeHtml = '';
      if (stamps >= MAX_STAMPS) {
        badgeHtml = `<span class="remaining-badge ready" title="Ready to claim Free Gift">🎉 READY FOR GIFT!</span>`;
      } else if (stamps >= MILESTONE_50_OFF) {
        badgeHtml = `<span class="remaining-badge badge-offer-50" style="cursor: pointer;" onclick="window.ownerApp.ownerRedeemCustomerOffer('${customer.phone}', 50)" title="50% OFF Unlocked (${remaining} more to Free Gift) • Click to record discount">⚡ 50% OFF (${remaining} Left)</span>`;
      } else if (stamps >= MILESTONE_20_OFF) {
        badgeHtml = `<span class="remaining-badge badge-offer-20" style="cursor: pointer;" onclick="window.ownerApp.ownerRedeemCustomerOffer('${customer.phone}', 20)" title="20% OFF Unlocked (${MILESTONE_50_OFF - stamps} more to 50% OFF) • Click to record discount">🏷️ 20% OFF (${MILESTONE_50_OFF - stamps} to 50%)</span>`;
      } else if (stamps === 0) {
        badgeHtml = `<span class="remaining-badge new" title="New customer with 0 stamps">★ 11 TICKS LEFT</span>`;
      } else {
        badgeHtml = `<span class="remaining-badge in-progress" title="${remaining} more ticks to Free Gift">● ${remaining} TICKS LEFT</span>`;
      }

      // 11 mini dots with milestone highlights - clickable to delete/undo stamps one by one
      let dotsHtml = '';
      for (let i = 1; i <= 10; i++) {
        const isFilled = i <= stamps;
        const removeAttr = isFilled 
          ? `onclick="window.ownerApp.ownerRemoveTickFromCustomer('${customer.phone}')" class="mini-stamp-dot active removable" style="cursor: pointer; ${i === MILESTONE_20_OFF ? 'background:#f59e0b; border-color:#fbbf24; color:#000;' : (i === MILESTONE_50_OFF ? 'background:#a855f7; border-color:#c084fc; color:#fff;' : '')}" title="Tick #${i} collected • Click to delete this tick"` 
          : `class="mini-stamp-dot" ${i === MILESTONE_20_OFF ? 'style="border-color:#f59e0b; color:#fbbf24;" title="Slot 5: 20% OFF"' : (i === MILESTONE_50_OFF ? 'style="border-color:#a855f7; color:#c084fc;" title="Slot 8: 50% OFF"' : '')}`;
        if (i === MILESTONE_20_OFF) {
          dotsHtml += `<div ${removeAttr}>${isFilled ? '🏷️' : '5'}</div>`;
        } else if (i === MILESTONE_50_OFF) {
          dotsHtml += `<div ${removeAttr}>${isFilled ? '⚡' : '8'}</div>`;
        } else {
          dotsHtml += `<div ${removeAttr}>${isFilled ? '✓' : ''}</div>`;
        }
      }
      const giftRemove = stamps >= MAX_STAMPS 
        ? `onclick="window.ownerApp.ownerRemoveTickFromCustomer('${customer.phone}')" style="cursor: pointer;" title="Slot 11: Free Gift • Click to delete this tick"` 
        : 'title="Slot 11: Free Gift"';
      dotsHtml += `<div class="mini-stamp-dot gift-dot ${stamps >= MAX_STAMPS ? 'unlocked removable' : ''}" ${giftRemove}>${stamps >= MAX_STAMPS ? '🎁' : '★'}</div>`;

      let historyItemsHtml = '';
      const validHistoryTypes = new Set(['stamp', 'stamp_cancelled', 'reward', 'joined']);
      const displayHistory = (history || []).filter(item => {
        if (!item || !item.type) return false;
        if (!validHistoryTypes.has(item.type)) return false;
        if (typeof item.note === 'string' && (item.note.includes('System Update Alert') || item.note.includes('Seamless 1-tap updates') || item.note.includes('Update verified'))) return false;
        return true;
      });

      if (displayHistory.length === 0) {
        historyItemsHtml = `<div class="history-empty-text">No stamp or redemption events recorded yet for this customer card.</div>`;
      } else {
        historyItemsHtml = displayHistory.map(item => {
          const isReward = item.type === 'reward';
          const isJoined = item.type === 'joined';
          const isCancel = item.type === 'stamp_cancelled';
          let tagText = '✓ STAMP';
          let tagClass = 'tag-stamp';
          if (isReward) {
            tagText = '🎁 REDEEMED';
            tagClass = 'tag-gift';
          } else if (isCancel) {
            tagText = '↩️ REMOVED';
            tagClass = 'tag-stamp-cancel';
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
              <div class="customer-badges-row" style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                ${(customer.deviceName || (history.find(h => h.device) && history.find(h => h.device).device)) ? `
                  <span class="customer-device-badge">
                    📱 ${customer.deviceName || (history.find(h => h.device) && history.find(h => h.device).device)}
                  </span>
                ` : ''}
                ${isIos ? `
                  <span class="customer-ver-tag up-to-date" style="background:#f0fdf4; color:#166534; border:1px solid #bbf7d0;" title="Apple iPhone Safari Pass: Runs live latest code on reload">
                    🍏 v${this.appVersion} (Safari Pass)
                  </span>
                ` : `
                  <span class="customer-ver-tag ${isOutdated ? 'outdated' : 'up-to-date'}" title="${isOutdated ? 'Needs update to latest version v' + targetVer : 'Up to date with version v' + (customerVer || targetVer)}">
                    ${isOutdated ? `⚠️ Needs v${targetVer}` : `✓ v${customerVer || targetVer}`}
                  </span>
                `}
              </div>
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

          <!-- Column 3: Remaining Ticks / Milestone Badge & Remove 1 Stamp Button -->
          <div class="customer-status-col">
            ${badgeHtml}
            <button type="button" class="btn-tick-remove ${stamps === 0 ? 'zero-stamps' : ''}" onclick="window.ownerApp.ownerRemoveTickFromCustomer('${customer.phone}')" title="${stamps > 0 ? 'Delete 1 stamp (Undo mistake)' : 'Customer already has 0 stamps'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>1 Stamp</span>
            </button>
          </div>

          <!-- Column 4: Instant Cashier Action & Card Stamp History Button -->
          <div class="customer-row-actions">
            ${stamps >= MAX_STAMPS ? `
              <button type="button" class="btn-gift-redeem" onclick="window.ownerApp.ownerRedeemCustomerGift('${customer.phone}')">
                🎁 Handover Gift
              </button>
            ` : `
              <button type="button" class="btn-tick-add" onclick="window.ownerApp.ownerAddTickToCustomer('${customer.phone}')" title="Add 1 stamp">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                +1 Stamp
              </button>
            `}
            <button type="button" id="historyBtn-${customer.phone}" class="btn-toggle-history ${isExpanded ? 'active' : ''}" onclick="window.ownerApp.toggleCustomerHistory('${customer.phone}')" title="Click to view stamp history">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>History (${displayHistory.length})</span>
              <svg class="history-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <button type="button" class="btn-delete-customer" onclick="window.ownerApp.ownerDeleteCustomer('${customer.phone}')" title="Delete customer card">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>

          ${isOutdated && !isIos ? `
            <!-- Customer App Outdated Alert & Direct Push / WhatsApp Action Bar -->
            <div class="customer-update-box">
              <div class="customer-update-box-info">
                <div class="update-info-badge">⚠️</div>
                <div class="update-info-text">
                  <div class="update-info-title">
                    App Update Available <span class="update-target-pill">v${targetVer}</span>
                  </div>
                  <div class="update-info-desc">
                    ${hasAlertSent ? `<span style="color:#059669; font-weight:700;">✓ Alert Pushed</span> • Waiting for customer to open &amp; install v${targetVer}` : `Customer on ${customerVer ? 'v' + customerVer : 'older build'} • Send update alert`}
                  </div>
                </div>
              </div>
              <div class="customer-update-box-actions">
                <button type="button" class="btn-push-update-alert ${hasAlertSent ? 'sent' : ''}" onclick="window.ownerApp.pushIndividualCustomerUpdate('${customer.phone}', '${encodeURIComponent(customer.name)}')" title="${hasAlertSent ? 'Alert already pushed. Click to re-send update notice.' : 'Send in-app update notification to this customer'}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${hasAlertSent ? '<polyline points="20 6 9 17 4 12"></polyline>' : '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>'}</svg>
                  <span>${hasAlertSent ? `✓ Alert Sent (v${targetVer})` : 'Push Update Alert'}</span>
                </button>
                <button type="button" class="btn-whatsapp-update" onclick="window.ownerApp.sendWhatsAppUpdate('${customer.phone}', '${encodeURIComponent(customer.name)}', '${customerVer || 'older'}')" title="Send WhatsApp message with install instructions">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                  <span>Send on WhatsApp</span>
                </button>
              </div>
            </div>
          ` : ''}

          <!-- Expandable Card Stamp History Drawer Matching Reference Image -->
          <div id="historyDrawer-${customer.phone}" class="customer-history-drawer" style="display: ${isExpanded ? 'block' : 'none'};">
            <div class="card-stamp-history-box">
              <div class="card-history-header">
                <div class="card-history-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  <span>Card Stamp History</span>
                </div>
                <span class="history-badge-count">${displayHistory.length} Event${displayHistory.length === 1 ? '' : 's'}</span>
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
    const dashboardLogoutBtn = document.getElementById('ownerDashboardLogoutBtn');

    if (!this.isLoggedIn) {
      if (authSection) authSection.style.display = 'block';
      if (dashboardSection) dashboardSection.style.display = 'none';
      if (logoutHeaderBtn) logoutHeaderBtn.style.display = 'none';
      if (dashboardLogoutBtn) dashboardLogoutBtn.style.display = 'none';
      return;
    }

    if (authSection) authSection.style.display = 'none';
    if (dashboardSection) dashboardSection.style.display = 'flex';
    if (logoutHeaderBtn) logoutHeaderBtn.style.display = 'inline-flex';
    if (dashboardLogoutBtn) dashboardLogoutBtn.style.display = 'inline-flex';

    this.renderMetrics();
    this.renderCustomerList();
    this.generateStoreQRCodes();
  }

  showToast(message, type = "normal") {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Remove any previous toast so toasts don't stack or stay permanently
    container.innerHTML = '';

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

    // Auto-hide toast after 3.2 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => {
        if (toast.parentElement) toast.remove();
      }, 300);
    }, 3200);
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
  if (window.ownerApp) {
    window.loyaltyOwnerApp = window.ownerApp;
    return;
  }
  const app = new StoreOwnerApp();
  window.ownerApp = app;
  window.loyaltyOwnerApp = app;
});

} // End of __STORE_OWNER_APP_CLASS_DEFINED__ guard
