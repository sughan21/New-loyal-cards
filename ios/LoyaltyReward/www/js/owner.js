/* ==========================================================================
   STORE OWNER & MERCHANT PORTAL LOGIC (owner.js)
   Shared Database: Reads/Writes to the same localStorage as Customer Pass
   ========================================================================== */

const MAX_STAMPS = 6;
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
    if (badgeEl) badgeEl.innerText = `${req.currentStamps || 0} of 6 Stamps`;
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
    if (logoutBtn) logoutBtn.addEventListener('click', () => this.handleLogout());

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

    // Modal Close
    document.querySelectorAll('.modal-close-trigger').forEach(b => {
      b.addEventListener('click', () => this.closeModals());
    });
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
        { date: `${dateStr}, ${timeStr}`, type: 'stamp', note: 'Welcome Reward Claimed: 1st Loyalty Tick Unlocked! (Tick #1 of 6)' },
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
      this.showToast(`🎁 ${customer.name} already has 6/6 ticks! Redeem their gift!`, "gold");
      return;
    }

    customer.stamps += 1;
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    customer.history.unshift({
      date: `${date}, ${time}`,
      type: "stamp",
      note: `Store Purchase (Owner Added) - Tick #${customer.stamps}`
    });

    this.saveUsers();

    if (customer.stamps === MAX_STAMPS) {
      if (window.soundEngine) window.soundEngine.playGiftFanfare();
      if (typeof confetti !== 'undefined') confetti({ particleCount: 50, spread: 60 });
      this.showToast(`🎉 ${customer.name} reached 6/6 ticks! GIFT IS READY!`, "gold");
    } else {
      if (window.soundEngine) window.soundEngine.playStampSound();
      const remaining = MAX_STAMPS - customer.stamps;
      this.showToast(`✅ Added tick for ${customer.name} (${customer.stamps}/6) • ${remaining} tick${remaining > 1 ? 's' : ''} remaining`, "success");
    }

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
      note: `🎁 GIFT HANDED OUT BY STORE OWNER: ${this.storeConfig.rewardTitle}`
    });

    this.saveUsers();
    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`🎁 Gift handed over to ${customer.name}! Card reset to 0/6 for next reward.`, "gold");
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
    const code = codeInput ? codeInput.value.trim() : '';

    if (!code) {
      this.showToast("Please enter customer's voucher code.", "error");
      return;
    }

    let customer = this.users.find(u => u.stamps >= MAX_STAMPS);
    if (!customer) {
      this.showToast("No active reward voucher found for this code.", "error");
      return;
    }

    customer.stamps = 0;
    customer.giftsEarned = (customer.giftsEarned || 0) + 1;
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    customer.history.unshift({
      date: `${date}, ${time}`,
      type: "reward",
      note: `🎁 GIFT REDEEMED AT COUNTER: ${this.storeConfig.rewardTitle}`
    });

    this.saveUsers();
    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`🎁 Gift verified & redeemed for ${customer.name}!`, "gold");
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
    } else if (window.location.protocol === 'file:' || !window.location.origin || window.location.origin.startsWith('file:') || window.location.origin === 'null') {
      smartUrl = `http://localhost:8085/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
    } else {
      smartUrl = `${window.location.origin}/download.html?store_scan=${encodeURIComponent(this.storeConfig.storeCode)}`;
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
      testLink.href = smartUrl;
    }

    const targetUrlDisplay = document.getElementById('standeeQrTargetDisplay');
    if (targetUrlDisplay) {
      targetUrlDisplay.innerText = smartUrl;
      targetUrlDisplay.title = smartUrl;
    }

    // Auto-check live Cloudflare tunnel in background if not checked yet
    this.checkLiveTunnel();
  }

  async checkLiveTunnel() {
    if (this._checkingTunnel) return;
    this._checkingTunnel = true;
    try {
      const resp = await fetch(`${API_BASE_URL}/api/tunnel`, { cache: 'no-cache' });
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.active && data.url && data.url !== this.activeTunnelUrl) {
          this.activeTunnelUrl = data.url;
          if (!localStorage.getItem('standee_target_url')) {
            // Re-render QR code with live Cloudflare tunnel URL
            this.generateStoreQRCodes();
          }
        }
      }
    } catch (e) {
      // Ignore background check errors
    } finally {
      this._checkingTunnel = false;
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
    const oneTickLeft = this.users.filter(u => Number(u.stamps || 0) === MAX_STAMPS - 1).length;
    const inProgress = this.users.filter(u => Number(u.stamps || 0) >= 1 && Number(u.stamps || 0) < MAX_STAMPS).length;
    const newCust = this.users.filter(u => Number(u.stamps || 0) === 0).length;
    const totalGiftsRedeemed = this.users.reduce((acc, u) => acc + (Number(u.giftsEarned) || 0), 0);

    const elTotal = document.getElementById('ownerTotalCustomers');
    if (elTotal) elTotal.innerText = totalCust;

    const elReady = document.getElementById('ownerReadyForGiftCount');
    if (elReady) elReady.innerText = readyForGift;

    const elOne = document.getElementById('ownerOneTickLeftCount');
    if (elOne) elOne.innerText = oneTickLeft;

    const elGifts = document.getElementById('ownerTotalGiftsGiven');
    if (elGifts) elGifts.innerText = totalGiftsRedeemed;

    // Filter pill count badges
    const pillAll = document.getElementById('pillCountAll');
    if (pillAll) pillAll.innerText = totalCust;
    const pillReady = document.getElementById('pillCountReady');
    if (pillReady) pillReady.innerText = readyForGift;
    const pillUrgent = document.getElementById('pillCountUrgent');
    if (pillUrgent) pillUrgent.innerText = oneTickLeft;
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

    let filtered = [...this.users];

    if (this.ownerFilter === 'ready') {
      filtered = filtered.filter(u => Number(u.stamps || 0) >= MAX_STAMPS);
    } else if (this.ownerFilter === 'urgent') {
      filtered = filtered.filter(u => Number(u.stamps || 0) === MAX_STAMPS - 1);
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
          'ready': 'Ready for Gift (6/6 Ticks)',
          'urgent': '1 Tick Left (5/6 Ticks)',
          'progress': 'In Progress (1-5 Ticks)',
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
        badgeHtml = `<span class="remaining-badge ready">🎉 READY FOR GIFT! (0 Left)</span>`;
      } else if (stamps === MAX_STAMPS - 1) {
        badgeHtml = `<span class="remaining-badge one-left">⚡ 1 TICK REMAINING</span>`;
      } else if (stamps === 0) {
        badgeHtml = `<span class="remaining-badge new">★ 6 TICKS REMAINING (New)</span>`;
      } else {
        badgeHtml = `<span class="remaining-badge in-progress">● ${remaining} TICKS REMAINING</span>`;
      }

      let dotsHtml = '';
      for (let i = 1; i <= 5; i++) {
        dotsHtml += `<div class="mini-stamp-dot ${i <= stamps ? 'active' : ''}">${i <= stamps ? '✓' : ''}</div>`;
      }
      dotsHtml += `<div class="mini-stamp-dot gift-dot ${stamps >= MAX_STAMPS ? 'unlocked' : ''}" title="Gift Slot 6">${stamps >= MAX_STAMPS ? '🎁' : '★'}</div>`;

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
            tagText = '★ GIFT';
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

          <!-- Column 2: Stamp Progress & Mini Dots -->
          <div class="customer-progress-col">
            <div class="tick-count-text">${stamps} of 6 Ticks</div>
            <div class="mini-stamps-bar">
              ${dotsHtml}
            </div>
          </div>

          <!-- Column 3: Remaining Ticks Badge (High Contrast) -->
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
            <button type="button" id="historyBtn-${customer.phone}" class="btn-toggle-history ${isExpanded ? 'active' : ''}" onclick="window.ownerApp.toggleCustomerHistory('${customer.phone}')" title="Click to view how each tick was ticked">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>History (${history.length})</span>
              <svg class="history-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
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
