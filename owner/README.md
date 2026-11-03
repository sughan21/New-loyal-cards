# 🏪 Store Owner Terminal (`/owner`)

The standalone cashier and merchant dashboard for stamping cards, approving 2nd-visit requests, and managing customer loyalty records.

---

## 🚀 Quick Launch
- **Local Web Terminal:** [http://localhost:8085/owner/](http://localhost:8085/owner/)
- **Direct File:** Open `index.html` in any modern web browser.
- **Android APK:** Precompiled APK available in `/download/apks/StoreTerminal-Owner.apk`.

---

## 🔑 Default Credentials
- **Username:** `owner` (or `admin`)
- **Password:** `owner123` (or `admin123`)
- **Cashier Quick PIN:** `1234`

---

## 📁 Folder Structure
```
owner/
├── index.html           # Main Merchant Dashboard & Cashier Terminal
├── manifest.json        # PWA Manifest (Store Terminal)
├── favicon-64.png       # App Favicon
├── favicon.ico
├── favicon.png
├── favicon.svg
├── css/
│   └── style.css        # Premium responsive styling
├── js/
│   ├── owner.js         # Merchant directory, stamping & approval engine
│   ├── audio.js         # Stamp confirmation sounds
│   ├── supabase-client.js # Real-time cloud sync & customer table operations
│   └── vendor/
│       ├── supabase.min.js
│       ├── html5-qrcode.min.js
│       └── qrcode.min.js
├── icons/
│   ├── owner-icon-192.png # Home screen icon (192x192)
│   └── owner-icon-512.png # Splash screen icon (512x512)
└── assets/
    ├── logo.png         # Merchant brand logo
    └── store_bg.jpg     # Background artwork
```

---

## 🎯 Key Features
1. **Live Customer Directory:**
   - Search customers by Name, Phone number, or Member ID.
   - Live tick counter (0/6 to 6/6) and Gifts Earned counters.
   - Filter by All, Eligible for Reward, or Active.

2. **One-Tap Counter Stamping:**
   - Tap `+1 Stamp` to instantly credit a purchase stamp.
   - Synchronizes immediately across local cache and Supabase cloud.

3. **Real-Time 2nd-Visit Approval Inbox:**
   - Detects when a customer scans the counter standee a second time today.
   - Displays instant popup with customer avatar, device info, and time.
   - Balanced `✓ Approve Stamp` and `✕ Decline` buttons.

4. **Counter Standee QR Generator:**
   - Instant full-screen printable QR code standee for the cash counter.
   - When scanned by any smartphone camera, immediately opens the customer pass or download portal.

5. **Security & Session Management:**
   - Protected admin login with show/hide password toggles.
   - Cashier PIN confirmation for gift redemptions.
