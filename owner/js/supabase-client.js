/* ==========================================================================
   GOLDEN PERKS - SUPABASE CLOUD DATABASE CLIENT & REPOSITORY
   Connects Customer App and Store Owner Portal directly to Supabase
   Supports Real-time Approvals, Cloud Sync, and Local Offline Fallback
   ========================================================================== */

const SUPABASE_CONFIG = {
  url: "https://rhqpiskqgfmotazjzbnm.supabase.co",
  anonKey: "sb_publishable_Jf7gwY9zb3exmw8RD98ERQ_o66Pq2xY"
};

class LoyaltySupabaseRepository {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.activeChannels = new Map();
    this.init();
  }

  init() {
    try {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        this.client = window.supabase.createClient(
          SUPABASE_CONFIG.url,
          SUPABASE_CONFIG.anonKey,
          {
            realtime: {
              params: {
                eventsPerSecond: 10
              }
            }
          }
        );
        this.isReady = true;
        console.log("⚡ Supabase Cloud Database Connected:", SUPABASE_CONFIG.url);
      } else {
        console.warn("⚠️ Supabase JS SDK not detected on window. Using local/REST fallback.");
      }
    } catch (e) {
      console.error("❌ Failed to initialize Supabase client:", e);
    }
  }



  // --- Data Mappers ---
  toDbCustomer(u) {
    if (!u) return null;
    let history = Array.isArray(u.history) ? [...u.history] : [];
    if (u.appVersion && history.length > 0) {
      if (!history[0].appVersion) {
        history[0] = { ...history[0], appVersion: u.appVersion, versionCode: u.versionCode || 12 };
      }
    }
    const row = {
      phone: String(u.phone).trim(),
      name: u.name || '',
      password: u.password || '',
      stamps: parseInt(u.stamps, 10) || 0,
      gifts_earned: parseInt(u.giftsEarned, 10) || 0,
      member_id: u.memberId || '',
      history: history,
      last_stamp_date: u.lastStampDate || null,
      last_updated: u.lastUpdated || Date.now()
    };
    if (u.deviceName) row.device_name = u.deviceName;
    if (u.deviceId) row.device_id = u.deviceId;
    return row;
  }

  toLocalCustomer(db) {
    if (!db) return null;
    let dev = db.device_name || '';
    let devId = db.device_id || '';
    let appVer = db.app_version || '';
    let verCode = db.version_code || 0;
    let alertObj = null;

    if (Array.isArray(db.history)) {
      if (db.history.length > 0 && db.history[0] && db.history[0].type === 'update_alert') {
        alertObj = {
          targetVersion: db.history[0].targetVersion || '',
          sentAt: db.history[0].date || '',
          status: 'pending'
        };
      }
      for (const h of db.history) {
        if (!dev && h && h.device) dev = h.device;
        if (!devId && h && h.deviceId) devId = h.deviceId;
        if (!appVer && h && (h.appVersion || h.version)) appVer = h.appVersion || h.version;
        if (!verCode && h && h.versionCode) verCode = h.versionCode;
      }
    }
    return {
      phone: String(db.phone),
      name: db.name || '',
      password: db.password || '',
      stamps: parseInt(db.stamps, 10) || 0,
      giftsEarned: parseInt(db.gifts_earned, 10) || 0,
      memberId: db.member_id || '',
      deviceName: dev,
      deviceId: devId,
      appVersion: appVer || '',
      versionCode: verCode || 0,
      updateAlert: alertObj,
      history: Array.isArray(db.history) ? db.history : [],
      lastStampDate: db.last_stamp_date || null,
      lastUpdated: db.last_updated || Date.now(),
      createdAt: db.created_at ? new Date(db.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
    };
  }

  toDbRequest(r) {
    if (!r) return null;
    return {
      id: r.id,
      phone: String(r.phone).trim(),
      name: r.name || '',
      member_id: r.memberId || '',
      current_stamps: parseInt(r.currentStamps, 10) || 0,
      time_str: r.timeStr || '',
      date_str: r.dateStr || '',
      timestamp: r.timestamp || Date.now(),
      status: r.status || 'pending'
    };
  }

  toLocalRequest(db) {
    if (!db) return null;
    return {
      id: db.id,
      phone: String(db.phone),
      name: db.name || '',
      memberId: db.member_id || '',
      currentStamps: parseInt(db.current_stamps, 10) || 0,
      timeStr: db.time_str || '',
      dateStr: db.date_str || '',
      timestamp: db.timestamp || (db.created_at ? new Date(db.created_at).getTime() : Date.now()),
      status: db.status || 'pending'
    };
  }

  // --- Customers API ---
  async fetchAllCustomers() {
    if (!this.isReady) return null;
    try {
      const { data, error } = await this.client
        .from('customers')
        .select('*')
        .neq('name', '__DELETED__')
        .order('last_updated', { ascending: false });

      if (error) {
        console.warn("Supabase fetchAllCustomers error:", error);
        return null;
      }
      return Array.isArray(data) 
        ? data.filter(d => d.phone && !d.phone.startsWith('__') && d.name !== '__DELETED__' && d.member_id !== '__DELETED__').map(d => this.toLocalCustomer(d)) 
        : [];
    } catch (e) {
      console.warn("Supabase network error:", e);
      return null;
    }
  }

  async fetchCustomer(phone) {
    if (!this.isReady || !phone) return null;
    try {
      const { data, error } = await this.client
        .from('customers')
        .select('*')
        .eq('phone', String(phone).trim())
        .maybeSingle();

      if (error) {
        console.warn("Supabase fetchCustomer error:", error);
        return null;
      }
      if (data && (data.name === '__DELETED__' || data.member_id === '__DELETED__')) {
        return null;
      }
      return data ? this.toLocalCustomer(data) : null;
    } catch (e) {
      console.warn("Supabase network error:", e);
      return null;
    }
  }

  async deleteCustomer(phone) {
    if (!this.isReady || !phone) return false;
    const cleanPhone = String(phone).trim();
    try {
      // 1. Attempt direct SQL DELETE
      try {
        await this.client
          .from('customers')
          .delete()
          .eq('phone', cleanPhone);
      } catch (_) {}

      // 2. Mark as __DELETED__ tombstone so query filters exclude it immediately
      const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      await this.client
        .from('customers')
        .update({
          name: '__DELETED__',
          member_id: '__DELETED__',
          stamps: 0,
          history: [{
            type: 'account_deleted',
            date: `${date}, ${time}`,
            note: 'Customer account permanently deleted by Store Owner'
          }],
          last_updated: Date.now()
        })
        .eq('phone', cleanPhone);

      // 3. Clean up any pending or past stamp requests for this customer
      try {
        await this.client
          .from('stamp_requests')
          .delete()
          .eq('phone', cleanPhone);
      } catch (_) {}

      return true;
    } catch (e) {
      console.error("Supabase deleteCustomer error:", e);
      return false;
    }
  }

  async upsertCustomer(customer) {
    if (!this.isReady || !customer || !customer.phone) return false;
    try {
      const row = this.toDbCustomer(customer);
      // Clean out any transient fields not in Supabase customers schema
      delete row.app_version;
      delete row.version_code;

      let { error } = await this.client
        .from('customers')
        .upsert(row, { onConflict: 'phone' });

      // If unmapped column error occurs, extract the column name, strip it, and retry
      if (error && error.message) {
        const matches = error.message.match(/Could not find the '([^']+)' column/);
        if (matches && matches[1]) {
          delete row[matches[1]];
          const res = await this.client.from('customers').upsert(row, { onConflict: 'phone' });
          error = res.error;
        }
      }

      if (error) {
        console.error("Supabase upsertCustomer error:", error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("Supabase network error:", e);
      return false;
    }
  }

  async upsertCustomers(customersList) {
    if (!this.isReady || !Array.isArray(customersList) || customersList.length === 0) return false;
    try {
      let rows = customersList.map(c => {
        const r = this.toDbCustomer(c);
        if (r) {
          delete r.app_version;
          delete r.version_code;
        }
        return r;
      }).filter(Boolean);

      let { error } = await this.client
        .from('customers')
        .upsert(rows, { onConflict: 'phone' });

      if (error && error.message) {
        const matches = error.message.match(/Could not find the '([^']+)' column/);
        if (matches && matches[1]) {
          rows.forEach(r => delete r[matches[1]]);
          const res = await this.client.from('customers').upsert(rows, { onConflict: 'phone' });
          error = res.error;
        }
      }

      if (error) {
        console.error("Supabase upsertCustomers error:", error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("Supabase network error:", e);
      return false;
    }
  }

  // --- Stamp Requests API ---
  async createStampRequest(req) {
    if (!this.isReady || !req) return false;
    try {
      const row = this.toDbRequest(req);
      const { error } = await this.client
        .from('stamp_requests')
        .upsert(row, { onConflict: 'id' });

      if (error) {
        console.error("Supabase createStampRequest error:", error);
        return false;
      }
      return true;
    } catch (e) {
      console.error("Supabase network error:", e);
      return false;
    }
  }

  async fetchPendingStampRequests() {
    if (!this.isReady) return [];
    try {
      const cutoff = Date.now() - (12 * 60 * 60 * 1000); // last 12 hours
      const { data, error } = await this.client
        .from('stamp_requests')
        .select('*')
        .eq('status', 'pending')
        .gte('timestamp', cutoff)
        .order('timestamp', { ascending: false });

      if (error) {
        console.warn("Supabase fetchPendingStampRequests error:", error);
        return [];
      }
      return Array.isArray(data) ? data.map(d => this.toLocalRequest(d)) : [];
    } catch (e) {
      console.warn("Supabase network error:", e);
      return [];
    }
  }

  async getStampRequestStatus(requestId) {
    if (!this.isReady || !requestId) return 'not_found';
    try {
      const { data, error } = await this.client
        .from('stamp_requests')
        .select('status')
        .eq('id', requestId)
        .maybeSingle();

      if (error || !data) return 'not_found';
      return data.status || 'pending';
    } catch (e) {
      return 'not_found';
    }
  }

  async resolveStampRequest(requestId, action, customerObj = null) {
    if (!this.isReady || !requestId) return { success: false, error: 'Not ready' };
    try {
      // 1. Update request status
      const { data: updatedReq, error: reqErr } = await this.client
        .from('stamp_requests')
        .update({ status: action })
        .eq('id', requestId)
        .select()
        .single();

      if (reqErr) {
        return { success: false, error: reqErr.message };
      }

      // 2. If approved, add stamp to customer in database
      if (action === 'approved' && updatedReq) {
        const phone = updatedReq.phone;
        let currentCust = customerObj || await this.fetchCustomer(phone);
        if (!currentCust) {
          currentCust = {
            phone: phone,
            name: updatedReq.name || 'Loyalty Member',
            memberId: updatedReq.member_id || ('GP-' + Math.floor(10000 + Math.random() * 90000)),
            stamps: parseInt(updatedReq.current_stamps, 10) || 0,
            giftsEarned: 0,
            history: []
          };
        }
        const currentStamps = parseInt(currentCust.stamps, 10) || 0;
        if (currentStamps < 11) {
          const nextStamps = currentStamps + 1;
          const now = new Date();
          const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
          const todayIso = now.toISOString().split('T')[0];

          const newHistItem = {
            date: `${dateStr}, ${timeStr}`,
            type: 'stamp',
            note: `Store Purchase (2nd Visit Cashier Approved) - Tick #${nextStamps} of 11 Collected`
          };

          const updatedHistory = [newHistItem, ...(currentCust.history || [])];
          currentCust.stamps = nextStamps;
          currentCust.history = updatedHistory;
          currentCust.lastStampDate = todayIso;
          currentCust.lastUpdated = Date.now();

          await this.upsertCustomer(currentCust);
        }
      }

      return { success: true, status: action };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // --- Realtime Subscriptions ---
  subscribeToRequestStatus(requestId, onStatusChange) {
    if (!this.isReady || !requestId) return null;
    const channelName = `req_status_${requestId}`;

    if (this.activeChannels.has(channelName)) {
      this.unsubscribe(channelName);
    }

    const channel = this.client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'stamp_requests',
          filter: `id=eq.${requestId}`
        },
        (payload) => {
          if (payload.new && payload.new.status) {
            onStatusChange(payload.new.status, this.toLocalRequest(payload.new));
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`📡 Realtime connected for request ${requestId}`);
        }
      });

    this.activeChannels.set(channelName, channel);
    return channel;
  }

  subscribeToPendingRequests(onNewOrUpdatedRequest) {
    if (!this.isReady) return null;
    const channelName = 'owner_pending_stream';

    if (this.activeChannels.has(channelName)) {
      this.unsubscribe(channelName);
    }

    const channel = this.client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'stamp_requests'
        },
        (payload) => {
          if (payload.new) {
            onNewOrUpdatedRequest(this.toLocalRequest(payload.new), payload.eventType);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log("📡 Realtime live stream connected for Store Owner");
        }
      });

    this.activeChannels.set(channelName, channel);
    return channel;
  }

  subscribeToCustomerUpdates(phone, onUpdate, onDelete) {
    if (!this.isReady || !phone) return null;
    const channelName = `cust_sync_${phone}`;

    if (this.activeChannels.has(channelName)) {
      this.unsubscribe(channelName);
    }

    const channel = this.client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customers',
          filter: `phone=eq.${String(phone).trim()}`
        },
        (payload) => {
          if (payload.eventType === 'DELETE' || (payload.new && (payload.new.name === '__DELETED__' || payload.new.member_id === '__DELETED__'))) {
            if (typeof onDelete === 'function') onDelete();
          } else if (payload.new) {
            onUpdate(this.toLocalCustomer(payload.new));
          }
        }
      )
      .subscribe();

    this.activeChannels.set(channelName, channel);
    return channel;
  }

  subscribeToAllCustomers(onCustomerChange) {
    if (!this.isReady) return null;
    const channelName = 'all_customers_stream';

    if (this.activeChannels.has(channelName)) {
      this.unsubscribe(channelName);
    }

    const channel = this.client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customers'
        },
        (payload) => {
          if (payload.new) {
            if (payload.new.name === '__DELETED__' || payload.new.member_id === '__DELETED__') {
              onCustomerChange({ phone: payload.new.phone }, 'DELETE');
              return;
            }
            const cust = this.toLocalCustomer(payload.new);
            onCustomerChange(cust, payload.eventType);
          } else if (payload.eventType === 'DELETE' && payload.old) {
            onCustomerChange({ phone: payload.old.phone }, 'DELETE');
          }
        }
      )
      .subscribe();

    this.activeChannels.set(channelName, channel);
    return channel;
  }

  // --- App Version Cloud Broadcast & Fetch ---
  async publishVersion(versionData) {
    if (!this.isReady || !versionData) return false;
    try {
      const row = {
        phone: '__APP_CONFIG_VERSION__',
        name: versionData.version || '1.6.3',
        password: '',
        stamps: versionData.versionCode || 9,
        gifts_earned: 0,
        member_id: 'APP-CONFIG',
        history: [versionData],
        last_stamp_date: null,
        last_updated: Date.now()
      };
      const { error } = await this.client.from('customers').upsert(row, { onConflict: 'phone' });
      if (error) {
        console.warn("Supabase publishVersion error:", error);
        return false;
      }
      return true;
    } catch (e) {
      console.warn("Supabase publishVersion exception:", e);
      return false;
    }
  }

  async fetchAppVersion() {
    if (!this.isReady) return null;
    try {
      const { data, error } = await this.client
        .from('customers')
        .select('*')
        .eq('phone', '__APP_CONFIG_VERSION__')
        .maybeSingle();

      if (error || !data) return null;
      if (Array.isArray(data.history) && data.history.length > 0) {
        return data.history[0];
      }
      return {
        version: data.name,
        versionCode: data.stamps,
        releaseDate: new Date().toISOString().slice(0, 10),
        title: "Loyalty Pass Update",
        notes: "Latest update from store owner."
      };
    } catch (e) {
      return null;
    }
  }

  unsubscribe(channelName) {
    if (this.activeChannels.has(channelName)) {
      const ch = this.activeChannels.get(channelName);
      if (ch && this.client) {
        this.client.removeChannel(ch);
      }
      this.activeChannels.delete(channelName);
    }
  }
}

// Global Singleton Instance
window.loyaltyDb = new LoyaltySupabaseRepository();

// --- Universal Device Info & Unique Hardware ID Detector ---
window.detectDeviceInfo = async function() {
  let userDeviceName = '';
  let deviceId = '';
  let modelFallback = '';

  // 1. Android & iOS Native App Bridge
  try {
    const bridge = window.IosBridge || window.AndroidBridge;
    if (bridge) {
      if (typeof bridge.getUserDeviceName === 'function') {
        userDeviceName = bridge.getUserDeviceName();
      }
      if (typeof bridge.getDeviceId === 'function') {
        deviceId = bridge.getDeviceId();
      }
      if (typeof bridge.getDeviceName === 'function') {
        modelFallback = bridge.getDeviceName();
      }
    }
  } catch (e) {}

  // 2. Generate or retrieve persistent unique Device ID if not available from Android
  if (!deviceId) {
    try {
      deviceId = localStorage.getItem('golden_device_uuid');
      if (!deviceId) {
        deviceId = 'DEV_' + Math.random().toString(36).substring(2, 10).toUpperCase() + '_' + Date.now().toString(36).toUpperCase();
        localStorage.setItem('golden_device_uuid', deviceId);
      }
    } catch (e) {
      deviceId = 'DEV_' + Date.now();
    }
  }

  // 3. User device name resolution (priority to user custom name over brand)
  let finalDeviceName = userDeviceName && userDeviceName.trim().length > 0 ? userDeviceName.trim() : '';

  if (!finalDeviceName) {
    const ua = navigator.userAgent || '';
    if (/iPhone/i.test(ua)) {
      const match = ua.match(/OS (\d+[_\.]\d+)/);
      finalDeviceName = match ? `Apple iPhone (iOS ${match[1].replace('_', '.')})` : "Apple iPhone";
    } else if (/iPad/i.test(ua)) {
      finalDeviceName = "Apple iPad";
    } else if (modelFallback) {
      finalDeviceName = modelFallback;
    } else {
      finalDeviceName = "Mobile Device";
    }
  }

  return {
    deviceName: finalDeviceName,
    deviceId: deviceId
  };
};

window.detectDeviceName = async function() {
  const info = await window.detectDeviceInfo();
  return info.deviceName;
};
