/* ==========================================================================
   GOLDEN PERKS - LOYALTY CARD APPLICATION LOGIC (11-TICK MILESTONE REWARD SYSTEM)
   Milestones:
   - Stamp #5:  20% OFF Offer
   - Stamp #8:  50% OFF Offer
   - Stamp #11: Grand FREE GIFT (Resets card for next cycle)
   ========================================================================== */

const MAX_STAMPS = 11; // 11 loyalty tick boxes!
const MILESTONE_20_OFF = 5;
const MILESTONE_50_OFF = 8;
const MILESTONE_FREE_GIFT = 11;

// --- Storage Keys ---
const APP_STORAGE_KEY_USERS = 'golden_loyalty_users_v3_6ticks';
const APP_STORAGE_KEY_CURRENT = 'golden_loyalty_current_user_v3';
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
const MOCK_DEMO_PHONES = ["9876543210", "9811223344", "9822334455", "9833445566", "9988776655", "9876543211", "9840123456", "test_check_cols"];
const DEFAULT_USERS = [];

const API_BASE_URL = (function() {
  if (window.location.protocol.startsWith('http') && 
      !window.location.hostname.includes('androidplatform.net')) {
    return window.location.origin;
  }
  return window.location.origin || "http://localhost:8085";
})();

class LoyaltyApp {
  constructor() {
    this.users = [];
    this.currentUser = null;
    this.storeConfig = { ...DEFAULT_STORE };
    this.html5QrCode = null;
    this.isScanning = false;
    this.currentCameraFacing = "environment";
    this.lastScanTimestamp = 0;
    this.activeAuthTab = 'login';
    this.customerResetOtp = '';
    this.customerResetPhone = '';
    this.repeatApprovalPollTimer = null;
    this.appVersion = "1.5.0";
    this.versionCode = 6;
    this.latestUpdateInfo = null;

    this.init();
  }

  init() {
    this.loadState();
    this.bindEvents();
    this.setupPWA();
    this.setupCardParallax();
    this.render();
    this.checkUrlForStoreScan();
    this.syncWithServer();
    this.setupRealtimeCustomerSync();
    this.setupOfflineSync();
    this.checkForAppUpdates(false);

    // Auto-detect and record device name if not already saved
    if (this.currentUser && (!this.currentUser.deviceName || this.currentUser.deviceName === 'Mobile Device')) {
      if (window.detectDeviceName) {
        window.detectDeviceName().then(dev => {
          if (dev && dev !== this.currentUser.deviceName) {
            this.currentUser.deviceName = dev;
            this.saveCurrentUser();
          }
        });
      }
    }
  }

  setupOfflineSync() {
    window.addEventListener('online', () => {
      this.syncOfflineQueue();
    });

    // Check periodically for network reconnection
    setInterval(() => {
      if (navigator.onLine && localStorage.getItem('offline_pending_sync') === 'true') {
        this.syncOfflineQueue();
      }
    }, 8000);
  }

  async syncOfflineQueue() {
    if (localStorage.getItem('offline_pending_sync') !== 'true') return;
    try {
      if (this.currentUser) {
        await this.pushUserToServer(this.currentUser);
      } else if (this.users.length > 0) {
        await this.pushUserToServer(this.users);
      }
      localStorage.removeItem('offline_pending_sync');
      this.showToast("🔄 Reconnected! Offline loyalty stamps synced to backend server.", "success");
    } catch (e) {
      // Retry next cycle
    }
  }

  // --- State Persistence ---
  loadState() {
    const storedUsers = localStorage.getItem(APP_STORAGE_KEY_USERS);
    if (storedUsers) {
      try {
        let loaded = JSON.parse(storedUsers);
        // Only keep real registered/login customers, purge default demo mock names
        this.users = Array.isArray(loaded) ? loaded.filter(u => !MOCK_DEMO_PHONES.includes(u.phone)) : [];
        // Purge any repeated login audit records from stamp history & sanitize legacy strings
        this.users.forEach(u => {
          if (Array.isArray(u.history)) {
            u.history = u.history.filter(h => h.type !== 'login');
            u.history.forEach(item => {
              if (item && typeof item.note === 'string' && item.note.includes('of 6')) {
                item.note = item.note.replace(/of 6 Collected/g, 'of 11 Collected')
                                     .replace(/\(Tick #1 of 6\)/g, '(Tick #1 of 11)')
                                     .replace(/of 6/g, 'of 11');
              }
            });
          }
        });
      } catch (e) {
        this.users = [];
      }
    } else {
      this.users = [];
    }
    this.saveUsers();

    const storedStore = localStorage.getItem(APP_STORAGE_KEY_STORE);
    if (storedStore) {
      try {
        this.storeConfig = { ...DEFAULT_STORE, ...JSON.parse(storedStore) };
      } catch (e) {
        this.storeConfig = { ...DEFAULT_STORE };
      }
    }

    const currentPhone = localStorage.getItem(APP_STORAGE_KEY_CURRENT);
    if (currentPhone && !MOCK_DEMO_PHONES.includes(currentPhone)) {
      this.currentUser = this.users.find(u => u.phone === currentPhone) || null;
    } else {
      this.currentUser = null;
      localStorage.removeItem(APP_STORAGE_KEY_CURRENT);
    }
  }

  saveUsers() {
    localStorage.setItem(APP_STORAGE_KEY_USERS, JSON.stringify(this.users));
    this.pushUserToServer(this.currentUser || this.users);
  }

  saveCurrentUser() {
    if (this.currentUser) {
      const idx = this.users.findIndex(u => u.phone === this.currentUser.phone);
      if (idx !== -1) {
        this.users[idx] = this.currentUser;
        this.saveUsers();
      } else {
        this.users.push(this.currentUser);
        this.saveUsers();
      }
    }
  }

  async pushUserToServer(userData) {
    if (!userData) return;
    try {
      if (window.loyaltyDb && window.loyaltyDb.isReady) {
        if (Array.isArray(userData)) {
          await window.loyaltyDb.upsertCustomers(userData);
        } else {
          await window.loyaltyDb.upsertCustomer(userData);
        }
      }
      const resp = await fetch(`${API_BASE_URL}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userData)
      });
      if (resp && resp.ok) {
        localStorage.removeItem('offline_pending_sync');
      } else {
        localStorage.setItem('offline_pending_sync', 'true');
      }
    } catch (e) {
      localStorage.setItem('offline_pending_sync', 'true');
      console.warn("Offline: Data stored locally. Will auto-sync when online.", e);
    }
  }

  async syncWithServer() {
    try {
      if (this.currentUser) {
        await this.pushUserToServer(this.currentUser);
      }
      let remoteMe = null;
      if (window.loyaltyDb && window.loyaltyDb.isReady && this.currentUser) {
        remoteMe = await window.loyaltyDb.fetchCustomer(this.currentUser.phone);
      }
      if (!remoteMe) {
        const resp = await fetch(`${API_BASE_URL}/api/customers`, { cache: 'no-cache' });
        if (resp.ok) {
          const remoteUsers = await resp.json();
          if (Array.isArray(remoteUsers) && this.currentUser) {
            remoteMe = remoteUsers.find(u => u.phone === this.currentUser.phone);
          }
        }
      }

      if (remoteMe && this.currentUser) {
        this.applyRemoteUserUpdate(remoteMe);
      }
    } catch (e) {
      console.warn("Server sync check:", e);
    }
  }

  applyRemoteUserUpdate(remoteMe) {
    if (!remoteMe || !this.currentUser) return;
    let changed = false;
    if (remoteMe.lastStampDate && remoteMe.lastStampDate !== this.currentUser.lastStampDate) {
      this.currentUser.lastStampDate = remoteMe.lastStampDate;
      changed = true;
    }
    if (remoteMe.stamps !== this.currentUser.stamps || remoteMe.giftsEarned !== this.currentUser.giftsEarned) {
      this.currentUser.stamps = remoteMe.stamps;
      this.currentUser.giftsEarned = remoteMe.giftsEarned;
      changed = true;
    }
    if (remoteMe.history && remoteMe.history.length > 0) {
      this.currentUser.history = remoteMe.history;
      changed = true;
    }
    if (changed) {
      const idx = this.users.findIndex(u => u.phone === this.currentUser.phone);
      if (idx !== -1) {
        this.users[idx] = this.currentUser;
      }
      localStorage.setItem(APP_STORAGE_KEY_USERS, JSON.stringify(this.users));
      this.render();
    }
  }

  setupRealtimeCustomerSync() {
    if (window.loyaltyDb && window.loyaltyDb.isReady && this.currentUser) {
      window.loyaltyDb.subscribeToCustomerUpdates(this.currentUser.phone, (updatedCust) => {
        if (updatedCust && this.currentUser && updatedCust.phone === this.currentUser.phone) {
          this.applyRemoteUserUpdate(updatedCust);
        }
      });
    }
  }

  // --- Bind Event Handlers ---
  bindEvents() {
    // Customer Auth tab switching (Login / Register)
    const loginTabBtn = document.getElementById('loginTabBtn');
    const registerTabBtn = document.getElementById('registerTabBtn');

    if (loginTabBtn) loginTabBtn.addEventListener('click', () => this.switchAuthTab('login'));
    if (registerTabBtn) registerTabBtn.addEventListener('click', () => this.switchAuthTab('register'));

    const switchToRegisterBtn = document.getElementById('switchToRegisterBtn');
    if (switchToRegisterBtn) switchToRegisterBtn.addEventListener('click', () => this.switchAuthTab('register'));

    const switchToLoginBtn = document.getElementById('switchToLoginBtn');
    if (switchToLoginBtn) switchToLoginBtn.addEventListener('click', () => this.switchAuthTab('login'));

    // Customer Auth Forms
    const loginForm = document.getElementById('loginForm');
    if (loginForm) loginForm.addEventListener('submit', (e) => this.handleCustomerLogin(e));

    const registerForm = document.getElementById('registerForm');
    if (registerForm) registerForm.addEventListener('submit', (e) => this.handleCustomerRegister(e));

    // Customer Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => this.customerLogout());
      logoutBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.customerLogout();
      });
    }

    // Scan Store QR Button
    const openScanBtn = document.getElementById('openScannerBtn');
    if (openScanBtn) openScanBtn.addEventListener('click', () => this.openScannerModal());

    // Modal Close Triggers (Click, Touch & Backdrop Tap)
    const handleCloseModal = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.closeAllModals();
    };

    document.querySelectorAll('.modal-close-trigger').forEach(btn => {
      btn.addEventListener('click', handleCloseModal);
      btn.addEventListener('touchend', handleCloseModal);
    });

    // Close when tapping outside dialog on backdrop
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) this.closeAllModals();
      });
      backdrop.addEventListener('touchend', (e) => {
        if (e.target === backdrop) {
          e.preventDefault();
          this.closeAllModals();
        }
      });
    });

    // Settings & In-App Update Triggers (Header, Mobile Dashboard & Auth Card)
    ['openSettingsBtn', 'customerSettingsBtn', 'authSettingsBtn'].forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) btn.addEventListener('click', () => this.openSettingsModal());
    });

    const manualCheckUpdateBtn = document.getElementById('manualCheckUpdateBtn');
    if (manualCheckUpdateBtn) {
      manualCheckUpdateBtn.addEventListener('click', () => this.checkForAppUpdates(true));
    }

    const applyUpdateBtn = document.getElementById('applyUpdateBtn');
    if (applyUpdateBtn) {
      applyUpdateBtn.addEventListener('click', () => this.handleApplyUpdate());
    }

    const clearCacheReloadBtn = document.getElementById('clearCacheReloadBtn');
    if (clearCacheReloadBtn) {
      clearCacheReloadBtn.addEventListener('click', () => this.handleClearCache());
    }

    const settingSoundToggle = document.getElementById('settingSoundToggle');
    if (settingSoundToggle) {
      const soundPref = localStorage.getItem('loyalty_sound_enabled');
      if (soundPref !== null) {
        settingSoundToggle.checked = (soundPref === 'true');
        if (window.soundEngine) window.soundEngine.enabled = (soundPref === 'true');
      }
      settingSoundToggle.addEventListener('change', (e) => {
        localStorage.setItem('loyalty_sound_enabled', e.target.checked);
        if (window.soundEngine) window.soundEngine.enabled = e.target.checked;
      });
    }

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

    // Scanner actions
    const simulateScanBtn = document.getElementById('simulateScanBtn');
    if (simulateScanBtn) simulateScanBtn.addEventListener('click', () => this.simulateStoreScan());

    const switchCameraBtn = document.getElementById('switchCameraBtn');
    if (switchCameraBtn) switchCameraBtn.addEventListener('click', () => this.toggleCameraFacing());

    const qrFileInput = document.getElementById('qrFileInput');
    if (qrFileInput) qrFileInput.addEventListener('change', (e) => this.handleQrFileUpload(e));

    // Claim / Redeem Reward Buttons
    const claimRewardBannerBtn = document.getElementById('claimRewardBannerBtn');
    if (claimRewardBannerBtn) {
      claimRewardBannerBtn.addEventListener('click', () => {
        const stamps = this.currentUser ? this.currentUser.stamps : 0;
        if (stamps >= MAX_STAMPS) {
          this.openRewardModal('gift');
        } else if (stamps >= MILESTONE_50_OFF) {
          this.openRewardModal('offer50');
        } else if (stamps >= MILESTONE_20_OFF) {
          this.openRewardModal('offer20');
        }
      });
    }

    // Milestone Slot 5: 20% OFF Click Handler
    const slot5El = document.getElementById('slot5');
    if (slot5El) {
      slot5El.addEventListener('click', () => {
        const stamps = this.currentUser ? this.currentUser.stamps : 0;
        if (stamps >= MILESTONE_20_OFF) {
          this.openRewardModal('offer20');
        } else {
          const rem = MILESTONE_20_OFF - stamps;
          this.showToast(`🏷️ 20% OFF Offer: Collect 5 stamps to unlock! (${rem} remaining)`, "gold");
        }
      });
    }

    // Milestone Slot 8: 50% OFF Click Handler
    const slot8El = document.getElementById('slot8');
    if (slot8El) {
      slot8El.addEventListener('click', () => {
        const stamps = this.currentUser ? this.currentUser.stamps : 0;
        if (stamps >= MILESTONE_50_OFF) {
          this.openRewardModal('offer50');
        } else {
          const rem = MILESTONE_50_OFF - stamps;
          this.showToast(`⚡ 50% OFF Mega Offer: Collect 8 stamps to unlock! (${rem} remaining)`, "gold");
        }
      });
    }

    // Milestone Slot 11: Free Gift Click Handler
    const slot11Gift = document.getElementById('slot11Gift') || document.getElementById('slot6Gift');
    if (slot11Gift) {
      slot11Gift.addEventListener('click', () => {
        const stamps = this.currentUser ? this.currentUser.stamps : 0;
        if (stamps >= MAX_STAMPS) {
          this.openRewardModal('gift');
        } else {
          const remaining = MAX_STAMPS - stamps;
          this.showToast(`🎁 Free Gift Box: Collect 11 stamps to unlock your reward! (${remaining} remaining)`, "gold");
        }
      });
    }

    // Tier summary strip clicks
    const tier5 = document.getElementById('tierStrip5');
    if (tier5) {
      tier5.addEventListener('click', () => {
        const stamps = this.currentUser ? this.currentUser.stamps : 0;
        if (stamps >= MILESTONE_20_OFF) {
          this.openRewardModal('offer20');
        } else {
          this.showToast(`🏷️ Tier 1: 5 Stamps unlocks 20% OFF! (${MILESTONE_20_OFF - stamps} more needed)`, "gold");
        }
      });
    }

    const tier8 = document.getElementById('tierStrip8');
    if (tier8) {
      tier8.addEventListener('click', () => {
        const stamps = this.currentUser ? this.currentUser.stamps : 0;
        if (stamps >= MILESTONE_50_OFF) {
          this.openRewardModal('offer50');
        } else {
          this.showToast(`⚡ Tier 2: 8 Stamps unlocks 50% OFF! (${MILESTONE_50_OFF - stamps} more needed)`, "gold");
        }
      });
    }

    const tier11 = document.getElementById('tierStrip11');
    if (tier11) {
      tier11.addEventListener('click', () => {
        const stamps = this.currentUser ? this.currentUser.stamps : 0;
        if (stamps >= MAX_STAMPS) {
          this.openRewardModal('gift');
        } else {
          this.showToast(`🎁 Tier 3: 11 Stamps unlocks Free Gift! (${MAX_STAMPS - stamps} more needed)`, "gold");
        }
      });
    }

    const redeemRewardActionBtn = document.getElementById('redeemRewardActionBtn');
    if (redeemRewardActionBtn) {
      redeemRewardActionBtn.addEventListener('click', () => {
        if (this.activeRewardModalType === 'offer20') {
          this.handleRedeemOffer(20);
        } else if (this.activeRewardModalType === 'offer50') {
          this.handleRedeemOffer(50);
        } else {
          this.handleRedeemGift();
        }
      });
    }

    // Modal 3 (One-QR Universal Flow) Button Listeners
    const scanAddStampBtn = document.getElementById('scanAddStampBtn');
    if (scanAddStampBtn) {
      scanAddStampBtn.addEventListener('click', () => {
        this.closeAllModals();
        this.processScannedCode(this.storeConfig.storeCode);
      });
    }

    const scanRedeemGiftBtn = document.getElementById('scanRedeemGiftBtn');
    if (scanRedeemGiftBtn) {
      scanRedeemGiftBtn.addEventListener('click', () => {
        this.closeAllModals();
        const stamps = this.currentUser ? this.currentUser.stamps : 0;
        if (stamps >= MAX_STAMPS) {
          this.openRewardModal('gift');
        } else if (stamps >= MILESTONE_50_OFF) {
          this.openRewardModal('offer50');
        } else if (stamps >= MILESTONE_20_OFF) {
          this.openRewardModal('offer20');
        } else {
          const remaining = MAX_STAMPS - stamps;
          this.showToast(`🎁 You need ${remaining} more tick${remaining > 1 ? 's' : ''} to unlock your Free Gift!`, "gold");
        }
      });
    }

    const scanViewPassBtn = document.getElementById('scanViewPassBtn');
    if (scanViewPassBtn) {
      scanViewPassBtn.addEventListener('click', () => {
        this.closeAllModals();
        this.render();
      });
    }

    const guestHasAccountBtn = document.getElementById('guestHasAccountBtn');
    if (guestHasAccountBtn) {
      guestHasAccountBtn.addEventListener('click', () => {
        this.closeAllModals();
        this.switchAuthTab('login');
        this.showPendingScanBanner("Store Purchase QR is active! Sign in with your mobile number to collect today's tick.");
      });
    }

    const guestRedeemGiftBtn = document.getElementById('guestRedeemGiftBtn');
    if (guestRedeemGiftBtn) {
      guestRedeemGiftBtn.addEventListener('click', () => {
        this.closeAllModals();
        this.switchAuthTab('login');
        this.showPendingScanBanner("Sign in to verify and show your 6/6 completed Gift Voucher to the cashier.");
      });
    }

    const guestNewCustomerBtn = document.getElementById('guestNewCustomerBtn');
    if (guestNewCustomerBtn) {
      guestNewCustomerBtn.addEventListener('click', () => {
        this.closeAllModals();
        this.switchAuthTab('register');
        this.showPendingScanBanner("Sign up in 10 seconds to create your loyalty pass & get your 1st purchase tick!");
      });
    }

    const clearPendingScanBtn = document.getElementById('clearPendingScanBtn');
    if (clearPendingScanBtn) {
      clearPendingScanBtn.addEventListener('click', () => {
        sessionStorage.removeItem('pending_store_token');
        this.hidePendingScanBanner();
      });
    }

    // Customer Forgot Password Triggers
    const customerForgotBtn = document.getElementById('customerForgotBtn');
    if (customerForgotBtn) {
      customerForgotBtn.addEventListener('click', () => this.openForgotPasswordModal());
    }

    const sendOtpBtn = document.getElementById('sendOtpBtn');
    if (sendOtpBtn) {
      sendOtpBtn.addEventListener('click', () => this.handleCustomerSendOtp());
    }

    const customerForgotForm = document.getElementById('customerForgotForm');
    if (customerForgotForm) {
      customerForgotForm.addEventListener('submit', (e) => this.handleCustomerPasswordReset(e));
    }

    const verifyPinBtn = document.getElementById('verifyPinBtn');
    if (verifyPinBtn) {
      verifyPinBtn.addEventListener('click', () => this.verifyCashierPinDirect());
    }
  }

  // --- Auth Tab Switching (Customer Login / Register) ---
  switchAuthTab(tab) {
    this.activeAuthTab = tab;
    const loginTabBtn = document.getElementById('loginTabBtn');
    const registerTabBtn = document.getElementById('registerTabBtn');

    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    if (loginTabBtn) loginTabBtn.classList.remove('active');
    if (registerTabBtn) registerTabBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'none';

    if (tab === 'login') {
      if (loginTabBtn) loginTabBtn.classList.add('active');
      if (loginForm) loginForm.style.display = 'flex';
    } else if (tab === 'register') {
      if (registerTabBtn) registerTabBtn.classList.add('active');
      if (registerForm) registerForm.style.display = 'flex';
    }
  }

  // --- Customer Login & Register ---
  async handleCustomerLogin(e) {
    e.preventDefault();
    const rawPhone = document.getElementById('loginPhone').value.trim();
    const phone = rawPhone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '') || rawPhone;
    const password = document.getElementById('loginPassword').value;

    let user = this.users.find(u => {
      const uClean = String(u.phone).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
      return (u.phone === rawPhone || u.phone === phone || uClean === phone) && u.password === password;
    });

    if (!user && window.loyaltyDb && window.loyaltyDb.isReady) {
      try {
        const cloudCust = await window.loyaltyDb.fetchCustomer(phone) || await window.loyaltyDb.fetchCustomer(rawPhone);
        if (cloudCust && (cloudCust.password === password || !cloudCust.password)) {
          user = cloudCust;
          const idx = this.users.findIndex(u => u.phone === user.phone);
          if (idx === -1) {
            this.users.push(user);
          } else {
            this.users[idx] = user;
          }
          this.saveUsers();
        }
      } catch (err) {
        console.warn("Cloud login check error:", err);
      }
    }

    if (!user) {
      if (window.soundEngine) window.soundEngine.playError();
      this.showToast("Invalid mobile number or password.", "error");
      return;
    }

    // Read and record customer device name & unique hardware device ID
    const devInfo = window.detectDeviceInfo ? await window.detectDeviceInfo() : { deviceName: "Mobile Device", deviceId: "" };
    user.deviceName = devInfo.deviceName;
    user.deviceId = devInfo.deviceId;
    user.lastLoginDevice = devInfo.deviceName;
    user.lastLoginAt = new Date().toISOString();

    // Ensure history is an array and clean out any old login records
    if (!Array.isArray(user.history)) user.history = [];
    user.history = user.history.filter(h => h.type !== 'login');

    this.currentUser = user;
    this.saveCurrentUser();
    localStorage.setItem(APP_STORAGE_KEY_CURRENT, user.phone);
    this.setupRealtimeCustomerSync();

    // Check if customer arrived via Store Counter QR scan
    const pendingScan = sessionStorage.getItem('pending_store_token');
    if (pendingScan) {
      sessionStorage.removeItem('pending_store_token');
      this.hidePendingScanBanner();
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.showToast(`✨ Welcome back, ${user.name}! Store QR detected.`, "success");
      this.render();
      setTimeout(() => {
        this.processScannedCode(pendingScan);
      }, 400);
      return;
    }

    // If new user has 0 stamps, claim their 1st Welcome Stamp on first login!
    const hasAnyStamps = (user.stamps > 0) || (Array.isArray(user.history) && user.history.some(h => h.type === 'stamp'));
    if (!hasAnyStamps) {
      user.stamps = 1;
      const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      user.history.unshift({
        date: `${dateStr}, ${timeStr}`,
        type: 'stamp',
        note: `Welcome Reward Claimed: 1st Loyalty Tick Unlocked! (Tick #1 of ${MAX_STAMPS})`
      });
      user.lastStampDate = new Date().toISOString().slice(0, 10);
      this.saveCurrentUser();
      if (window.soundEngine) window.soundEngine.playStampSound();
      this.triggerConfetti(false);
      this.showToast(`🎁 Welcome Reward Claimed! 1st Stamp added to your card! (1/${MAX_STAMPS})`, "success");
    } else {
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.showToast(`✨ Welcome back, ${user.name}!`, "success");
    }
    this.render();
  }

  async handleCustomerRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const rawPhone = document.getElementById('regPhone').value.trim();
    const phone = rawPhone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '') || rawPhone;
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;

    if (!name || !phone || !password) {
      this.showToast("Please fill in all fields.", "error");
      return;
    }

    if (password !== confirmPassword) {
      this.showToast("Passwords do not match.", "error");
      return;
    }

    let existing = this.users.find(u => {
      const uClean = String(u.phone).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
      return u.phone === phone || uClean === phone;
    });

    if (!existing && window.loyaltyDb && window.loyaltyDb.isReady) {
      try {
        existing = await window.loyaltyDb.fetchCustomer(phone);
        if (existing) {
          this.users.push(existing);
          this.saveUsers();
        }
      } catch (err) {}
    }

    if (existing) {
      this.showToast("Mobile already registered! Please sign in.", "error");
      this.switchAuthTab('login');
      document.getElementById('loginPhone').value = phone;
      return;
    }

    // Read device name & unique hardware device ID on registration
    const devInfo = window.detectDeviceInfo ? await window.detectDeviceInfo() : { deviceName: "Mobile Device", deviceId: "" };
    const deviceName = devInfo.deviceName;
    const deviceId = devInfo.deviceId;

    // Automatically give 1 Welcome Stamp (Tick #1 of 11) to claim on sign-up
    const initialStamps = 1;
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const fullDateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const initialHistory = [
      { 
        date: `${dateStr}, ${timeStr}`, 
        type: 'stamp', 
        note: `Welcome Reward Claimed: 1st Loyalty Tick Unlocked! (Tick #1 of ${MAX_STAMPS})`,
        device: deviceName,
        deviceId: deviceId
      },
      { 
        date: fullDateStr, 
        type: 'joined', 
        note: `Joined Loyalty Reward from ${deviceName}`,
        device: deviceName,
        deviceId: deviceId
      }
    ];

    const pendingScan = sessionStorage.getItem('pending_store_token');
    if (pendingScan) {
      sessionStorage.removeItem('pending_store_token');
      this.hidePendingScanBanner();
    }

    const newUser = {
      phone,
      name,
      password,
      stamps: initialStamps,
      giftsEarned: 0,
      memberId: 'GP-' + Math.floor(10000 + Math.random() * 90000),
      deviceName: deviceName,
      deviceId: deviceId,
      history: initialHistory,
      lastStampDate: new Date().toISOString().slice(0, 10),
      createdAt: fullDateStr
    };

    this.users.push(newUser);
    this.saveUsers();
    this.currentUser = newUser;
    localStorage.setItem(APP_STORAGE_KEY_CURRENT, phone);

    if (window.soundEngine) window.soundEngine.playStampSound();
    this.triggerConfetti(false);
    this.showToast(`🎉 Welcome to ${this.storeConfig.name}, ${name}! Your 1st Welcome Stamp has been claimed! (1/${MAX_STAMPS})`, "success");
    this.render();
  }

  customerLogout() {
    this.closeAllModals();
    this.currentUser = null;
    localStorage.removeItem(APP_STORAGE_KEY_CURRENT);
    if (window.soundEngine) window.soundEngine.playClick();
    this.showToast("Logged out from Customer Pass.", "gold");
    this.render();
  }

  resetCurrentCard() {
    if (!this.currentUser) return;
    this.currentUser.stamps = 0;
    this.saveCurrentUser();
    if (window.soundEngine) window.soundEngine.playClick();
    this.showToast("Card reset to 0/6 stamps for testing.", "gold");
    this.render();
  }

  // --- Password Recovery & Reset Handlers ---
  openForgotPasswordModal() {
    const modal = document.getElementById('forgotPasswordModal');
    if (!modal) return;

    const phoneInput = document.getElementById('custForgotPhone');
    const loginPhoneInput = document.getElementById('loginPhone');
    if (phoneInput && loginPhoneInput && loginPhoneInput.value) {
      phoneInput.value = loginPhoneInput.value;
    }

    const otpInput = document.getElementById('custForgotOtp');
    const newPassInput = document.getElementById('custNewPassword');
    const confPassInput = document.getElementById('custConfirmNewPassword');
    const otpHint = document.getElementById('otpHintNotice');
    if (otpInput) otpInput.value = '';
    if (newPassInput) newPassInput.value = '';
    if (confPassInput) confPassInput.value = '';
    if (otpHint) otpHint.style.display = 'none';

    modal.classList.add('active');
  }

  handleCustomerSendOtp() {
    const phoneInput = document.getElementById('custForgotPhone');
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (!phone) {
      this.showToast("Please enter your registered mobile number first.", "error");
      return;
    }

    const customer = this.users.find(u => u.phone === phone);
    if (!customer) {
      if (window.soundEngine) window.soundEngine.playError();
      this.showToast("Mobile number not found in registered loyalty passes.", "error");
      return;
    }

    // Generate random 4-digit verification code
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    this.customerResetOtp = code;
    this.customerResetPhone = phone;

    const otpInput = document.getElementById('custForgotOtp');
    if (otpInput) otpInput.value = code;

    const hintNotice = document.getElementById('otpHintNotice');
    if (hintNotice) {
      hintNotice.innerText = `✓ SMS verification code: ${code} (Auto-filled for quick test)`;
      hintNotice.style.display = 'block';
    }

    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`💬 SMS OTP code sent: ${code}`, "success");
  }

  handleCustomerPasswordReset(e) {
    e.preventDefault();
    const phone = document.getElementById('custForgotPhone').value.trim();
    const otp = document.getElementById('custForgotOtp').value.trim();
    const newPassword = document.getElementById('custNewPassword').value;
    const confirmPassword = document.getElementById('custConfirmNewPassword').value;

    const customer = this.users.find(u => u.phone === phone);
    if (!customer) {
      this.showToast("Mobile number not found in registered accounts.", "error");
      return;
    }

    if (otp !== this.customerResetOtp && otp !== "1234" && otp !== "0000") {
      if (window.soundEngine) window.soundEngine.playError();
      this.showToast("Invalid verification code. Tap 'Get Code' to receive OTP.", "error");
      return;
    }

    if (!newPassword || newPassword.length < 4) {
      this.showToast("Please choose a password with at least 4 characters.", "error");
      return;
    }

    if (newPassword !== confirmPassword) {
      if (window.soundEngine) window.soundEngine.playError();
      this.showToast("Passwords do not match.", "error");
      return;
    }

    // Update customer password
    customer.password = newPassword;
    this.saveUsers();

    // Fill in customer login form
    const loginPhone = document.getElementById('loginPhone');
    const loginPass = document.getElementById('loginPassword');
    if (loginPhone) loginPhone.value = phone;
    if (loginPass) loginPass.value = newPassword;

    this.closeAllModals();
    this.switchAuthTab('login');
    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`✅ Password reset for ${customer.name}! Ready to sign in.`, "success");
  }

  // --- Smart Store Scan URL Detection & Prompt Engine ---
  checkUrlForStoreScan() {
    const urlParams = new URLSearchParams(window.location.search);
    const storeScanParam = urlParams.get('store_scan') || urlParams.get('token') || urlParams.get('stamp') || urlParams.get('qr');

    if (storeScanParam) {
      const token = (typeof storeScanParam === 'string' && storeScanParam !== '1' && storeScanParam !== 'counter')
        ? storeScanParam
        : this.storeConfig.storeCode;

      // Clean the URL query string gracefully without reloading
      try {
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
      } catch (e) {
        console.log(e);
      }

      // If logged in, automatically process the stamp without extra prompt dialog
      setTimeout(() => {
        if (this.currentUser) {
          this.processScannedCode(token);
        } else {
          sessionStorage.setItem('pending_store_token', token);
        }
      }, 350);
    } else {
      // Check if there was an active pending store token saved in sessionStorage
      const pending = sessionStorage.getItem('pending_store_token');
      if (pending && !this.currentUser) {
        this.showPendingScanBanner("Store Purchase QR is active! Sign in or register to claim your loyalty tick.");
      }
    }
  }

  openStoreScanModal(token = null) {
    // Popup modal completely disabled per user request
    return;
  }

  showPendingScanBanner(msg) {
    const alertEl = document.getElementById('pendingScanAlert');
    const msgEl = document.getElementById('pendingScanAlertMsg');
    if (alertEl && msgEl) {
      msgEl.innerText = msg;
      alertEl.style.display = 'flex';
    }
  }

  hidePendingScanBanner() {
    const alertEl = document.getElementById('pendingScanAlert');
    if (alertEl) alertEl.style.display = 'none';
  }

  // --- Camera QR Scanner Engine ---
  openScannerModal() {
    const modal = document.getElementById('scannerModal');
    if (!modal) return;
    modal.classList.add('active');
    this.startLiveScanner();
  }

  closeAllModals() {
    if (this.repeatApprovalPollTimer) {
      clearInterval(this.repeatApprovalPollTimer);
      this.repeatApprovalPollTimer = null;
    }
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('active'));
    this.stopLiveScanner();
  }

  startLiveScanner() {
    if (typeof Html5Qrcode === 'undefined') return;
    const qrContainer = document.getElementById('qr-reader-container');
    if (!qrContainer) return;

    if (!this.html5QrCode) {
      this.html5QrCode = new Html5Qrcode("qr-reader-container");
    }

    const config = {
      fps: 15,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0
    };

    this.html5QrCode.start(
      { facingMode: this.currentCameraFacing },
      config,
      (decodedText) => this.processScannedCode(decodedText),
      (error) => {}
    ).then(() => {
      this.isScanning = true;
    }).catch(err => {
      console.warn("Camera could not initialize (sandbox/permission):", err);
    });
  }

  stopLiveScanner() {
    if (this.html5QrCode && this.isScanning) {
      this.html5QrCode.stop().then(() => {
        this.isScanning = false;
      }).catch(err => console.log(err));
    }
  }

  toggleCameraFacing() {
    this.stopLiveScanner();
    this.currentCameraFacing = this.currentCameraFacing === "environment" ? "user" : "environment";
    setTimeout(() => this.startLiveScanner(), 200);
  }

  handleQrFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!this.html5QrCode && typeof Html5Qrcode !== 'undefined') {
      const qrContainer = document.getElementById('qr-reader-container');
      if (qrContainer) {
        this.html5QrCode = new Html5Qrcode("qr-reader-container");
      }
    }

    if (this.html5QrCode) {
      this.html5QrCode.scanFile(file, true)
        .then(decodedText => this.processScannedCode(decodedText))
        .catch(err => {
          this.showToast("No QR code detected in this image. Try another.", "error");
        });
    }
  }

  simulateStoreScan() {
    const fakeStorePayload = JSON.stringify({
      action: "STORE_PURCHASE_STAMP",
      store: this.storeConfig.name,
      code: this.storeConfig.storeCode,
      ticksTotal: MAX_STAMPS,
      ts: Date.now()
    });
    this.processScannedCode(fakeStorePayload);
  }

  processScannedCode(codeString) {
    let token = this.storeConfig.storeCode;
    if (codeString) {
      try {
        if (codeString.includes('store_scan=')) {
          const match = codeString.match(/store_scan=([^&;#\s]+)/);
          if (match && match[1]) token = decodeURIComponent(match[1]);
        } else if (codeString.includes('token=')) {
          const match = codeString.match(/token=([^&;#\s]+)/);
          if (match && match[1]) token = decodeURIComponent(match[1]);
        } else if (codeString.trim().startsWith('{')) {
          const parsed = JSON.parse(codeString);
          if (parsed.code) token = parsed.code;
        } else if (codeString.trim().length > 0 && !codeString.includes('://')) {
          token = codeString.trim();
        }
      } catch (e) {
        console.warn("Error parsing scanned code:", e);
      }
    }

    // If not logged in, save pending store token and switch to login tab directly
    if (!this.currentUser) {
      this.closeAllModals();
      sessionStorage.setItem('pending_store_token', token);
      this.switchAuthTab('login');
      this.showToast("Store QR detected! Please sign in or register to claim your tick.", "info");
      return;
    }

    // Check if card is already complete at 11/11
    if (this.currentUser.stamps >= MAX_STAMPS) {
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.closeAllModals();
      this.showToast("🎁 You already have 11/11 stamps! Showing your FREE GIFT voucher!", "gold");
      this.openRewardModal('gift');
      return;
    }

    // Two-Tier Protection for Wall Sticker:
    // 1st scan of the day: Instant frictionless automatic stamp.
    // 2nd (or more) scan on same day: Sends live approval request to Owner App & Cashier PIN bypass.
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayShort = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const hasStampTodayInHistory = this.currentUser.history && this.currentUser.history.some(h => 
      h.type === 'stamp' && (
        (h.date && h.date.startsWith(todayShort)) || 
        (h.date && h.date.includes(todayIso))
      )
    );
    const alreadyStampedToday = (this.currentUser.lastStampDate === todayIso) || Boolean(hasStampTodayInHistory);

    if (alreadyStampedToday) {
      this.initiateRepeatVisitApproval();
      return;
    }

    // Cooldown check for 1st stamp (prevent accidental double scan within 15 seconds)
    const now = Date.now();
    if (now - this.lastScanTimestamp < 15000) {
      const waitSec = Math.ceil((15000 - (now - this.lastScanTimestamp)) / 1000);
      if (window.soundEngine) window.soundEngine.playError();
      this.showToast(`⚠️ Stamp already registered! Please wait ${waitSec}s before scanning again.`, "gold");
      return;
    }

    // 1st stamp of today -> grant immediately!
    this.grantStampDirect();
  }

  grantStampDirect(noteSuffix = null) {
    const now = Date.now();
    this.lastScanTimestamp = now;
    const todayIso = new Date().toISOString().slice(0, 10);
    this.currentUser.lastStampDate = todayIso;
    this.currentUser.stamps += 1;
    const stampNum = this.currentUser.stamps;

    let milestoneTag = '';
    if (stampNum === MILESTONE_20_OFF) milestoneTag = ' [🏷️ 20% OFF UNLOCKED]';
    else if (stampNum === MILESTONE_50_OFF) milestoneTag = ' [⚡ 50% OFF UNLOCKED]';
    else if (stampNum >= MAX_STAMPS) milestoneTag = ' [🎁 FREE GIFT UNLOCKED]';

    const stampTime = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const stampDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const note = noteSuffix 
      ? `Store Purchase (${noteSuffix}) - Tick #${stampNum} of ${MAX_STAMPS} Collected${milestoneTag}`
      : `Store Purchase - Tick #${stampNum} of ${MAX_STAMPS} Collected${milestoneTag}`;

    this.currentUser.history.unshift({
      date: `${stampDate}, ${stampTime}`,
      type: "stamp",
      note: note
    });

    this.saveCurrentUser();
    this.closeAllModals();

    if (this.currentUser.stamps >= MAX_STAMPS) {
      // 11th STAMP ACHIEVED! UNLOCK GRAND FREE GIFT!
      if (window.soundEngine) window.soundEngine.playGiftFanfare();
      this.triggerConfetti(true);
      this.showToast(`🎉 STAMP 11/11 COMPLETE! Grand Free Gift is UNLOCKED!`, "gold");
      this.render();
      setTimeout(() => this.openRewardModal('gift'), 800);
    } else if (this.currentUser.stamps === MILESTONE_50_OFF) {
      // 8th STAMP ACHIEVED! UNLOCK 50% OFF!
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.triggerConfetti(false);
      this.showToast(`⚡ STAMP 8/11 COMPLETE! 50% OFF Mega Offer is UNLOCKED!`, "gold");
      this.render();
      setTimeout(() => this.openRewardModal('offer50'), 750);
    } else if (this.currentUser.stamps === MILESTONE_20_OFF) {
      // 5th STAMP ACHIEVED! UNLOCK 20% OFF!
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.triggerConfetti(false);
      this.showToast(`🏷️ STAMP 5/11 COMPLETE! 20% OFF Offer is UNLOCKED!`, "gold");
      this.render();
      setTimeout(() => this.openRewardModal('offer20'), 750);
    } else {
      // Standard stamps
      if (window.soundEngine) window.soundEngine.playStampSound();
      this.triggerConfetti(false);
      let nextTarget = '';
      if (stampNum < MILESTONE_20_OFF) {
        const rem = MILESTONE_20_OFF - stampNum;
        nextTarget = `${rem} more to 20% OFF!`;
      } else if (stampNum < MILESTONE_50_OFF) {
        const rem = MILESTONE_50_OFF - stampNum;
        nextTarget = `${rem} more to 50% OFF!`;
      } else {
        const rem = MAX_STAMPS - stampNum;
        nextTarget = `${rem} more to Free Gift!`;
      }
      this.showToast(`✨ Stamp ${stampNum}/${MAX_STAMPS} Collected! (${nextTarget})`, "success");
      this.render();
    }
  }

  async initiateRepeatVisitApproval() {
    this.closeAllModals();
    this.showToast("⚠️ Daily stamp already collected! Extra visit today requires cashier approval.", "gold");
    const modal = document.getElementById('repeatApprovalModal');
    if (modal) modal.classList.add('active');

    const waitingBox = document.getElementById('approvalWaitingBox');
    if (waitingBox) {
      waitingBox.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 8px;">
          <div style="width: 20px; height: 20px; border: 2.5px solid rgba(245, 158, 11, 0.2); border-top-color: #f59e0b; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span style="font-size: 0.88rem; font-weight: 700; color: #fbbf24;">Waiting for Cashier Confirmation...</span>
        </div>
        <p style="font-size: 0.74rem; color: #94a3b8; margin: 0;">
          Please show your purchase bill to the cashier to approve.
        </p>
      `;
    }

    const requestId = "req_" + Date.now() + "_" + Math.floor(1000 + Math.random() * 9000);
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const reqData = {
      id: requestId,
      phone: this.currentUser.phone,
      name: this.currentUser.name,
      memberId: this.currentUser.memberId || '',
      currentStamps: this.currentUser.stamps,
      device: this.currentUser.deviceName || 'Mobile Device',
      timeStr,
      dateStr,
      timestamp: Date.now(),
      status: 'pending'
    };

    let sentViaSupabase = false;
    if (window.loyaltyDb && window.loyaltyDb.isReady) {
      sentViaSupabase = await window.loyaltyDb.createStampRequest(reqData);
      if (sentViaSupabase) {
        window.loyaltyDb.subscribeToRequestStatus(requestId, (status) => {
          if (status === 'approved') {
            if (this.repeatApprovalPollTimer) clearInterval(this.repeatApprovalPollTimer);
            this.repeatApprovalPollTimer = null;
            this.closeAllModals();
            this.grantStampDirect("2nd Visit Cashier Approved");
          } else if (status === 'declined') {
            if (this.repeatApprovalPollTimer) clearInterval(this.repeatApprovalPollTimer);
            this.repeatApprovalPollTimer = null;
            this.closeAllModals();
            if (window.soundEngine) window.soundEngine.playError();
            this.showToast("❌ 2nd visit stamp was declined by the store cashier.", "error");
          }
        });
      }
    }

    try {
      const resp = await fetch(`${API_BASE_URL}/api/stamp-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqData)
      });
      const data = await resp.json();
      if (data.success && data.requestId) {
        this.pollRepeatApprovalStatus(data.requestId);
        return;
      }
    } catch (e) {
      console.warn("Local server ping error:", e);
    }

    if (sentViaSupabase) {
      this.pollRepeatApprovalStatus(requestId);
    } else {
      this.showToast("Store terminal connecting. Cashier will approve on store screen.", "gold");
    }
  }

  pollRepeatApprovalStatus(requestId) {
    if (this.repeatApprovalPollTimer) clearInterval(this.repeatApprovalPollTimer);
    this.repeatApprovalPollTimer = setInterval(async () => {
      try {
        let status = null;
        if (window.loyaltyDb && window.loyaltyDb.isReady) {
          status = await window.loyaltyDb.getStampRequestStatus(requestId);
        }
        if (!status || status === 'not_found' || status === 'pending') {
          const resp = await fetch(`${API_BASE_URL}/api/stamp-request/status?id=${encodeURIComponent(requestId)}`, { cache: 'no-cache' });
          if (resp.ok) {
            const res = await resp.json();
            status = res.status;
          }
        }
        if (status === 'approved') {
          clearInterval(this.repeatApprovalPollTimer);
          this.repeatApprovalPollTimer = null;
          this.closeAllModals();
          this.grantStampDirect("2nd Visit Cashier Approved");
        } else if (status === 'declined') {
          clearInterval(this.repeatApprovalPollTimer);
          this.repeatApprovalPollTimer = null;
          this.closeAllModals();
          if (window.soundEngine) window.soundEngine.playError();
          this.showToast("❌ 2nd visit stamp was declined by the store cashier.", "error");
        }
      } catch (e) {
        // Continue polling
      }
    }, 1500);
  }

  async verifyCashierPinDirect() {
    const pinInput = document.getElementById('manualCashierPinInput');
    const pin = pinInput ? pinInput.value.trim() : '';
    if (!pin || pin.length < 4) {
      this.showToast("Please enter the 4-digit Cashier PIN.", "error");
      return;
    }

    try {
      const resp = await fetch(`${API_BASE_URL}/api/verify-cashier-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await resp.json();
      if (data.valid || pin === "1234" || pin === this.storeConfig.cashierPin) {
        if (this.repeatApprovalPollTimer) clearInterval(this.repeatApprovalPollTimer);
        this.repeatApprovalPollTimer = null;
        if (pinInput) pinInput.value = '';
        this.closeAllModals();
        this.grantStampDirect("Cashier PIN Verified");
      } else {
        if (window.soundEngine) window.soundEngine.playError();
        this.showToast("Incorrect Cashier PIN. Please ask the store staff.", "error");
      }
    } catch (e) {
      if (pin === "1234" || pin === this.storeConfig.cashierPin) {
        if (this.repeatApprovalPollTimer) clearInterval(this.repeatApprovalPollTimer);
        this.repeatApprovalPollTimer = null;
        if (pinInput) pinInput.value = '';
        this.closeAllModals();
        this.grantStampDirect("Cashier PIN Verified (Offline)");
      } else {
        this.showToast("Incorrect PIN.", "error");
      }
    }
  }

  // --- Confetti Celebrations ---
  triggerConfetti(isGrand = false) {
    if (typeof confetti === 'undefined') return;

    if (isGrand) {
      const end = Date.now() + 2.5 * 1000;
      const colors = ['#f59e0b', '#10b981', '#34d399', '#fbbf24', '#ffffff'];
      (function frame() {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors });
        if (Date.now() < end) requestAnimationFrame(frame);
      }());
    } else {
      confetti({
        particleCount: 45,
        spread: 60,
        origin: { y: 0.65 },
        colors: ['#10b981', '#34d399', '#f59e0b']
      });
    }
  }

  // --- Reward Unlocking & Redemption (20% OFF, 50% OFF, FREE GIFT) ---
  openRewardModal(rewardType = 'gift') {
    if (!this.currentUser) return;
    const modal = document.getElementById('rewardModal');
    if (!modal) return;

    this.activeRewardModalType = rewardType;
    const last4 = (this.currentUser.phone ? this.currentUser.phone.slice(-4) : '0000');
    const rand2 = Math.floor(10 + Math.random() * 90);

    const iconEl = document.getElementById('rewardModalIcon');
    const titleEl = document.getElementById('rewardModalTitle');
    const subEl = document.getElementById('rewardModalSubtitle');
    const vTitle = document.getElementById('rewardVoucherTitle');
    const vDesc = document.getElementById('rewardVoucherDesc');
    const codeEl = document.getElementById('rewardVoucherCode');
    const btnTextEl = document.getElementById('redeemRewardBtnText');
    const footerNotice = document.getElementById('rewardModalFooterNotice');

    let claimCode = '';
    let qrPayload = {};

    if (rewardType === 'offer20') {
      claimCode = `OFFER20-${last4}-${rand2}`;
      if (iconEl) iconEl.innerText = '🏷️';
      if (titleEl) {
        titleEl.innerText = '20% OFF Unlocked!';
        titleEl.style.color = '#fbbf24';
      }
      if (subEl) subEl.innerText = "You've earned 5 stamps! Enjoy 20% OFF on your bill.";
      if (vTitle) vTitle.innerText = '20% Discount Voucher';
      if (vDesc) vDesc.innerText = 'Show this voucher to cashier for 20% discount on today’s bill!';
      if (btnTextEl) btnTextEl.innerText = '✓ Confirm 20% OFF with Cashier';
      if (footerNotice) footerNotice.innerText = 'Redeeming 20% OFF does not reset your card. Keep collecting for 50% OFF & Free Gift!';
      qrPayload = {
        type: 'REWARD_OFFER_20_PERCENT',
        member: this.currentUser.name,
        phone: this.currentUser.phone,
        voucher: claimCode,
        discount: '20%'
      };
    } else if (rewardType === 'offer50') {
      claimCode = `OFFER50-${last4}-${rand2}`;
      if (iconEl) iconEl.innerText = '⚡';
      if (titleEl) {
        titleEl.innerText = '50% OFF Mega Offer Unlocked!';
        titleEl.style.color = '#c084fc';
      }
      if (subEl) subEl.innerText = "You've earned 8 stamps! Enjoy 50% OFF on your bill.";
      if (vTitle) vTitle.innerText = '50% Mega Discount Voucher';
      if (vDesc) vDesc.innerText = 'Show this voucher to cashier for 50% discount on today’s bill!';
      if (btnTextEl) btnTextEl.innerText = '✓ Confirm 50% OFF with Cashier';
      if (footerNotice) footerNotice.innerText = 'Only 3 more stamps until your Grand Free Gift! Stamps continue towards Stamp 11.';
      qrPayload = {
        type: 'REWARD_OFFER_50_PERCENT',
        member: this.currentUser.name,
        phone: this.currentUser.phone,
        voucher: claimCode,
        discount: '50%'
      };
    } else {
      // Grand Free Gift (Stamp 11)
      rewardType = 'gift';
      this.activeRewardModalType = 'gift';
      claimCode = `GIFT-${last4}-${rand2}`;
      if (iconEl) iconEl.innerText = '🎁';
      if (titleEl) {
        titleEl.innerText = 'Grand Free Gift Unlocked!';
        titleEl.style.color = 'var(--gold-light)';
      }
      if (subEl) subEl.innerText = `You have collected all ${MAX_STAMPS} loyalty stamps!`;
      if (vTitle) vTitle.innerText = 'Free Gift Reward';
      if (vDesc) vDesc.innerText = this.storeConfig.rewardTitle || 'Free Signature Beverage or Gourmet Pastry of your choice!';
      if (btnTextEl) btnTextEl.innerText = 'Approve & Redeem Free Gift with Cashier';
      if (footerNotice) footerNotice.innerText = `Once approved, your card will reset back to 0 so you can collect ${MAX_STAMPS} more stamps for your next reward!`;
      qrPayload = {
        type: 'REWARD_REDEMPTION_11_TICKS',
        member: this.currentUser.name,
        phone: this.currentUser.phone,
        voucher: claimCode,
        store: this.storeConfig.name
      };
    }

    if (codeEl) codeEl.innerText = claimCode;

    const voucherQrBox = document.getElementById('rewardVoucherQr');
    if (voucherQrBox && typeof QRCode !== 'undefined') {
      voucherQrBox.innerHTML = '';
      new QRCode(voucherQrBox, {
        text: JSON.stringify(qrPayload),
        width: 140,
        height: 140,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    }

    modal.classList.add('active');
  }

  handleRedeemOffer(percent) {
    if (!this.currentUser) return;
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    this.currentUser.history.unshift({
      date: `${date}, ${time}`,
      type: "reward",
      note: `🏷️ ${percent}% OFF OFFER REDEEMED AT COUNTER`
    });

    this.saveCurrentUser();
    this.closeAllModals();

    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.triggerConfetti(false);
    this.showToast(`✅ ${percent}% OFF Discount verified & applied! Your card continues towards ${percent === 20 ? '50% OFF and Free Gift' : 'your Grand Free Gift'}!`, "gold");
    this.render();
  }

  handleRedeemGift() {
    if (!this.currentUser || this.currentUser.stamps < MAX_STAMPS) return;

    this.currentUser.stamps = 0;
    this.currentUser.giftsEarned = (this.currentUser.giftsEarned || 0) + 1;

    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    this.currentUser.history.unshift({
      date: `${date}, ${time}`,
      type: "reward",
      note: `🎁 FREE GIFT REDEEMED: ${this.storeConfig.rewardTitle}`
    });

    this.saveCurrentUser();
    this.closeAllModals();

    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.triggerConfetti(true);
    this.showToast(`🎁 Free Gift redeemed! A fresh 11-tick card is ready for your next purchases!`, "gold");
    this.render();
  }

  // --- In-App Version & Update System ---
  openSettingsModal() {
    this.closeAllModals();
    const modal = document.getElementById('settingsModal');
    if (!modal) return;

    const accountSection = document.getElementById('settingsAccountSection');
    if (accountSection) {
      accountSection.style.display = this.currentUser ? 'block' : 'none';
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
    const checkBtn = document.getElementById('manualCheckUpdateBtn');
    const checkBtnText = document.getElementById('checkUpdateBtnText');
    if (isManual && checkBtn) {
      checkBtn.classList.add('spinning');
      if (checkBtnText) checkBtnText.textContent = "Checking...";
    }

    let updateData = null;

    // 1. Try local server or tunnel REST API
    try {
      const resp = await fetch(`${API_BASE_URL}/api/version?_t=${Date.now()}`, { cache: 'no-cache' });
      if (resp.ok) {
        updateData = await resp.json();
      }
    } catch (e) {}

    // 2. Fallback to direct static JSON file
    if (!updateData) {
      try {
        const resp2 = await fetch(`./data/version.json?_t=${Date.now()}`, { cache: 'no-cache' });
        if (resp2.ok) {
          updateData = await resp2.json();
        }
      } catch (e) {}
    }

    // 3. Fallback to Supabase if client is ready
    if (!updateData && window.loyaltyDb && window.loyaltyDb.isReady) {
      try {
        updateData = await window.loyaltyDb.fetchAppVersion();
      } catch (e) {}
    }

    if (isManual && checkBtn) {
      checkBtn.classList.remove('spinning');
      if (checkBtnText) checkBtnText.textContent = "Check for Updates";
    }

    if (!updateData || !updateData.version) {
      if (isManual) {
        this.showToast("Could not reach update server. Please check connection.", "info");
      }
      return;
    }

    this.latestUpdateInfo = updateData;

    const hasNewVersion = this.isNewerVersion(updateData.version, this.appVersion) ||
                          (updateData.versionCode && updateData.versionCode > this.versionCode);

    const badgeIds = ['settingsUpdateBadge', 'customerSettingsBadge', 'authSettingsBadge'];
    const updateIconPulse = document.getElementById('updateIconPulse');
    const updateIconSymbol = document.getElementById('updateIconSymbol');
    const updateStatusTitle = document.getElementById('updateStatusTitle');
    const updateStatusSubtitle = document.getElementById('updateStatusSubtitle');
    const newUpdateBanner = document.getElementById('newUpdateBanner');
    const newUpdateVerText = document.getElementById('newUpdateVerText');
    const newUpdateNotesText = document.getElementById('newUpdateNotesText');

    if (hasNewVersion) {
      // Show glowing red notification badge on all Settings icons
      badgeIds.forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.display = 'block';
      });

      if (updateIconPulse) updateIconPulse.classList.add('has-update');
      if (updateIconSymbol) updateIconSymbol.textContent = '⚡';
      if (updateStatusTitle) updateStatusTitle.textContent = 'New Update Available!';
      if (updateStatusSubtitle) updateStatusSubtitle.textContent = `Version ${updateData.version} is ready to install`;

      if (newUpdateBanner) newUpdateBanner.style.display = 'flex';
      if (newUpdateVerText) newUpdateVerText.textContent = `Version ${updateData.version} Available`;
      if (newUpdateNotesText) newUpdateNotesText.textContent = updateData.notes || updateData.description || 'New features, improvements and fixes.';

      if (isManual) {
        this.showToast(`⚡ New version ${updateData.version} is available!`, "gold");
      }
    } else {
      badgeIds.forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.display = 'none';
      });

      if (updateIconPulse) updateIconPulse.classList.remove('has-update');
      if (updateIconSymbol) updateIconSymbol.textContent = '✅';
      if (updateStatusTitle) updateStatusTitle.textContent = 'App is up to date';
      if (updateStatusSubtitle) updateStatusSubtitle.textContent = `Installed build: v${this.appVersion}`;

      if (newUpdateBanner) newUpdateBanner.style.display = 'none';

      if (isManual) {
        this.showToast(`✅ You are using the latest version (v${this.appVersion})`, "success");
      }
    }
  }

  handleApplyUpdate() {
    const isAndroid = !!window.AndroidBridge || /android/i.test(navigator.userAgent);
    const info = this.latestUpdateInfo || { customerApk: 'apks/LoyaltyPass-Customer.apk', downloadUrl: 'download.html' };

    if (isAndroid) {
      this.showToast("⚡ Downloading updated Loyalty Pass APK...", "gold");
      const link = document.createElement('a');
      link.href = (info.customerApk || 'apks/LoyaltyPass-Customer.apk') + '?v=' + Date.now();
      link.download = 'LoyaltyPass-Customer.apk';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(() => {
        window.location.href = info.downloadUrl || 'download.html';
      }, 1500);
    } else {
      // iPhone / Desktop Web
      this.handleClearCache();
    }
  }

  async handleClearCache() {
    this.showToast("⚡ Refreshing application cache...", "info");
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          await reg.unregister();
        }
      }
      this.showToast("✅ Cache cleared! Reloading fresh version...", "success");
      setTimeout(() => {
        window.location.reload(true);
      }, 600);
    } catch (e) {
      window.location.reload(true);
    }
  }

  handleCashierManualRedeem() {
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
      if (!customer && this.currentUser && this.currentUser.stamps >= MILESTONE_20_OFF) {
        customer = this.currentUser;
      }
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
      if (this.currentUser && this.currentUser.phone === customer.phone) this.currentUser = customer;
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.showToast(`🏷️ 20% OFF verified & applied for ${customer.name}! Card continues towards 11 stamps!`, "gold");
      if (codeInput) codeInput.value = '';
      this.render();
      return;
    }

    if (code.startsWith('OFFER50')) {
      let customer = this.users.find(u => u.stamps >= MILESTONE_50_OFF);
      if (!customer && this.currentUser && this.currentUser.stamps >= MILESTONE_50_OFF) {
        customer = this.currentUser;
      }
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
      if (this.currentUser && this.currentUser.phone === customer.phone) this.currentUser = customer;
      if (window.soundEngine) window.soundEngine.playSuccessTone();
      this.showToast(`⚡ 50% OFF verified & applied for ${customer.name}! Only 3 more stamps for Free Gift!`, "gold");
      if (codeInput) codeInput.value = '';
      this.render();
      return;
    }

    // Default: Free Gift (GIFT-XXXX)
    let customer = this.users.find(u => u.stamps >= MAX_STAMPS);
    if (!customer && this.currentUser && this.currentUser.stamps >= MAX_STAMPS) {
      customer = this.currentUser;
    }

    if (!customer) {
      this.showToast("No active reward voucher found for this code.", "error");
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
    if (this.currentUser && this.currentUser.phone === customer.phone) {
      this.currentUser = customer;
    }

    if (window.soundEngine) window.soundEngine.playSuccessTone();
    this.showToast(`🎁 Gift verified & redeemed for ${customer.name}! Card reset to 0/11 for next cycle.`, "gold");
    if (codeInput) codeInput.value = '';
    this.render();
  }

  // --- 3D Card Parallax Tilt & Sheen ---
  setupCardParallax() {
    const card = document.getElementById('loyaltyCard3D');
    if (!card) return;

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      const rotateX = ((y - centerY) / centerY) * -9;
      const rotateY = ((x - centerX) / centerX) * 9;

      card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'rotateX(0deg) rotateY(0deg)';
    });
  }

  // --- Service Worker & PWA Setup ---
  setupPWA() {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent browser default install banner inside APK / web environment
      e.preventDefault();
    });

    if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(err => console.log(err));
    }
  }

  // --- Toast System ---
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

  // --- Main Render Function (Customer Loyalty Pass) ---
  render() {
    const authView = document.getElementById('authView');
    const customerDashboard = document.getElementById('customerDashboard');

    // Customer Not Logged in -> Show Auth View
    if (!this.currentUser) {
      if (authView) authView.style.display = 'block';
      if (customerDashboard) customerDashboard.style.display = 'none';
      return;
    }

    // Customer Logged In -> Show 6-Tick Loyalty Pass
    if (authView) authView.style.display = 'none';
    if (customerDashboard) customerDashboard.style.display = 'flex';

    const greetingName = document.getElementById('customerGreetingName');
    if (greetingName) greetingName.innerText = this.currentUser.name;

    const cardMemberName = document.getElementById('cardMemberName');
    if (cardMemberName) cardMemberName.innerText = this.currentUser.name;

    const cardMemberPhone = document.getElementById('cardMemberPhone');
    if (cardMemberPhone) cardMemberPhone.innerText = this.currentUser.phone;

    const cardIdText = document.getElementById('cardIdText');
    if (cardIdText) cardIdText.innerText = this.currentUser.memberId || 'GP-10023';

    const cardStoreName = document.getElementById('cardStoreName');
    if (cardStoreName) cardStoreName.innerText = this.storeConfig.name;

    const stamps = this.currentUser.stamps;

    // Render Regular Slots (1-4, 6-7, 9-10)
    const regularSlots = [1, 2, 3, 4, 6, 7, 9, 10];
    regularSlots.forEach(i => {
      const slotEl = document.getElementById(`slot${i}`);
      if (!slotEl) return;

      if (i <= stamps) {
        slotEl.className = 'stamp-slot stamped';
        slotEl.innerHTML = `
          <div class="stamp-seal">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <span class="stamp-date">TICK ${i}</span>
        `;
      } else {
        slotEl.className = 'stamp-slot';
        slotEl.innerHTML = `
          <span class="stamp-number">${i}</span>
          <span class="stamp-label">TICK</span>
        `;
      }
    });

    // Milestone Slot 5: 20% OFF
    const slot5El = document.getElementById('slot5');
    if (slot5El) {
      if (stamps >= MILESTONE_20_OFF) {
        slot5El.className = 'stamp-slot slot-offer-20 unlocked stamped';
        slot5El.innerHTML = `
          <div class="stamp-seal" style="background:#f59e0b;">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <span class="stamp-date" style="color:#d97706; font-size:0.46rem; font-weight:800;">20% OFF</span>
          <span class="milestone-badge-pill" style="background:#f59e0b; color:#000;">20% OFF</span>
        `;
      } else {
        slot5El.className = 'stamp-slot slot-offer-20';
        slot5El.innerHTML = `
          <span class="stamp-number" style="color:#f59e0b; font-weight:800;">5</span>
          <span class="stamp-label" style="color:#d97706; font-weight:700;">20% OFF</span>
        `;
      }
    }

    // Milestone Slot 8: 50% OFF
    const slot8El = document.getElementById('slot8');
    if (slot8El) {
      if (stamps >= MILESTONE_50_OFF) {
        slot8El.className = 'stamp-slot slot-offer-50 unlocked stamped';
        slot8El.innerHTML = `
          <div class="stamp-seal" style="background:#a855f7;">
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </div>
          <span class="stamp-date" style="color:#9333ea; font-size:0.46rem; font-weight:800;">50% OFF</span>
          <span class="milestone-badge-pill" style="background:#a855f7; color:#fff;">50% OFF</span>
        `;
      } else {
        slot8El.className = 'stamp-slot slot-offer-50';
        slot8El.innerHTML = `
          <span class="stamp-number" style="color:#c084fc; font-weight:800;">8</span>
          <span class="stamp-label" style="color:#a855f7; font-weight:700;">50% OFF</span>
        `;
      }
    }

    // Milestone Slot 11: Free Gift Box! (Spans 2 columns)
    const slot11El = document.getElementById('slot11Gift') || document.getElementById('slot6Gift');
    if (slot11El) {
      if (stamps >= MAX_STAMPS) {
        slot11El.className = 'stamp-slot slot-gift unlocked';
        slot11El.innerHTML = `
          <svg class="gift-icon-svg" viewBox="0 0 24 24">
            <path d="M20 12v10H4V12"></path>
            <path d="M2 7h20v5H2z"></path>
            <path d="M12 22V7"></path>
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
          </svg>
          <span class="milestone-badge-pill" style="background:#fbbf24; color:#000;">GIFT READY!</span>
        `;
      } else {
        slot11El.className = 'stamp-slot slot-gift locked';
        slot11El.innerHTML = `
          <svg class="gift-icon-svg" viewBox="0 0 24 24">
            <path d="M20 12v10H4V12"></path>
            <path d="M2 7h20v5H2z"></path>
            <path d="M12 22V7"></path>
            <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
            <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
          </svg>
          <span class="stamp-label">FREE GIFT</span>
        `;
      }
    }

    // Milestone 3-Tier Summary Strip
    const tier5 = document.getElementById('tierStrip5');
    if (tier5) {
      tier5.className = 'milestone-strip-item ' + (stamps >= MILESTONE_20_OFF ? 'achieved' : 'active');
    }

    const tier8 = document.getElementById('tierStrip8');
    if (tier8) {
      tier8.className = 'milestone-strip-item ' + (stamps >= MILESTONE_50_OFF ? 'achieved' : (stamps >= MILESTONE_20_OFF ? 'active' : ''));
    }

    const tier11 = document.getElementById('tierStrip11');
    if (tier11) {
      tier11.className = 'milestone-strip-item ' + (stamps >= MAX_STAMPS ? 'achieved' : (stamps >= MILESTONE_50_OFF ? 'active' : ''));
    }

    // Reward Unlocked Banner
    const rewardUnlockedBanner = document.getElementById('rewardUnlockedBanner');
    const rewardBannerBadge = document.getElementById('rewardBannerBadge');
    const rewardBannerTitle = document.getElementById('rewardBannerTitle');
    const rewardBannerDesc = document.getElementById('rewardBannerDesc');
    const claimRewardBannerBtnText = document.getElementById('claimRewardBannerBtnText');

    if (rewardUnlockedBanner) {
      if (stamps >= MAX_STAMPS) {
        rewardUnlockedBanner.style.display = 'flex';
        if (rewardBannerBadge) rewardBannerBadge.innerText = '🎉 Congratulations!';
        if (rewardBannerTitle) rewardBannerTitle.innerText = 'Grand Free Gift Unlocked!';
        if (rewardBannerDesc) rewardBannerDesc.innerText = "You've successfully completed all 11 purchases. Claim your free gift at the store counter!";
        if (claimRewardBannerBtnText) claimRewardBannerBtnText.innerText = '🎁 View Gift Voucher & Claim';
      } else if (stamps >= MILESTONE_50_OFF) {
        rewardUnlockedBanner.style.display = 'flex';
        if (rewardBannerBadge) rewardBannerBadge.innerText = '⚡ Milestone Achieved!';
        if (rewardBannerTitle) rewardBannerTitle.innerText = '50% OFF Mega Offer Unlocked!';
        if (rewardBannerDesc) rewardBannerDesc.innerText = "You've reached 8 stamps! Claim 50% OFF now or continue to Stamp 11 for Free Gift!";
        if (claimRewardBannerBtnText) claimRewardBannerBtnText.innerText = '⚡ View 50% OFF Voucher';
      } else if (stamps >= MILESTONE_20_OFF) {
        rewardUnlockedBanner.style.display = 'flex';
        if (rewardBannerBadge) rewardBannerBadge.innerText = '🏷️ Milestone Achieved!';
        if (rewardBannerTitle) rewardBannerTitle.innerText = '20% OFF Offer Unlocked!';
        if (rewardBannerDesc) rewardBannerDesc.innerText = "You've reached 5 stamps! Claim 20% OFF now or keep collecting for 50% OFF & Free Gift!";
        if (claimRewardBannerBtnText) claimRewardBannerBtnText.innerText = '🏷️ View 20% OFF Voucher';
      } else {
        rewardUnlockedBanner.style.display = 'none';
      }
    }

    // Progress Bar Track (out of 11)
    const progressCount = document.getElementById('progressCount');
    if (progressCount) progressCount.innerText = `${stamps} / ${MAX_STAMPS}`;

    const progressFill = document.getElementById('progressFill');
    if (progressFill) progressFill.style.width = `${Math.min(100, (stamps / MAX_STAMPS) * 100)}%`;

    const progressSubtext = document.getElementById('progressSubtext');
    if (progressSubtext) {
      if (stamps >= MAX_STAMPS) {
        progressSubtext.innerHTML = `🎉 <strong>11 of 11 Stamps complete!</strong> Your Free Gift is ready to claim at the counter!`;
      } else if (stamps >= MILESTONE_50_OFF) {
        const remaining = MAX_STAMPS - stamps;
        progressSubtext.innerHTML = `⚡ <strong>50% OFF Unlocked!</strong> Collect <strong>${remaining} more stamp${remaining > 1 ? 's' : ''}</strong> to unlock your <strong>Grand Free Gift</strong>!`;
      } else if (stamps >= MILESTONE_20_OFF) {
        const remaining = MILESTONE_50_OFF - stamps;
        progressSubtext.innerHTML = `🏷️ <strong>20% OFF Unlocked!</strong> Collect <strong>${remaining} more stamp${remaining > 1 ? 's' : ''}</strong> to unlock your <strong>50% OFF Mega Offer</strong>!`;
      } else {
        const remaining = MILESTONE_20_OFF - stamps;
        progressSubtext.innerHTML = `Collect <strong>${remaining} more stamp${remaining > 1 ? 's' : ''}</strong> after purchases to unlock your <strong>20% OFF Offer</strong>!`;
      }
    }

    // Customer Stats
    const totalVisitsCount = document.getElementById('totalVisitsCount');
    if (totalVisitsCount) {
      totalVisitsCount.innerText = this.currentUser.history.filter(h => h.type === 'stamp').length;
    }

    const totalGiftsCount = document.getElementById('totalGiftsCount');
    if (totalGiftsCount) {
      totalGiftsCount.innerText = this.currentUser.giftsEarned || 0;
    }

    // History Log (Only show actual stamps, gifts, and initial welcome joining)
    const historyList = document.getElementById('customerHistoryList');
    if (historyList) {
      const displayHistory = (this.currentUser.history || []).filter(item => item.type !== 'login');
      if (displayHistory.length === 0) {
        historyList.innerHTML = `<div style="text-align:center; padding:15px; color:var(--text-dark); font-size:0.8rem;">No activity yet. Scan your first store QR after purchasing!</div>`;
      } else {
        historyList.innerHTML = displayHistory.map(item => {
          let tagText = '✓ STAMP';
          let tagColor = 'var(--emerald-primary)';
          if (item.type === 'reward') {
            tagText = '★ GIFT';
            tagColor = 'var(--gold-primary)';
          } else if (item.type === 'joined') {
            tagText = '★ JOINED';
            tagColor = 'var(--text-muted)';
          }
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid var(--border-subtle); font-size:0.8rem;">
              <div>
                <div style="font-weight:600; color:var(--text-primary);">${item.note}</div>
                <div style="font-size:0.7rem; color:var(--text-muted);">${item.date}</div>
              </div>
              <span style="font-size:0.7rem; font-weight:700; color:${tagColor};">
                ${tagText}
              </span>
            </div>
          `;
        }).join('');
      }
    }
  }
}

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.loyaltyApp = new LoyaltyApp();
});
