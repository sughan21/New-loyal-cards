# 👤 Customer Loyalty Pass App (`/customer`)

The standalone web and mobile PWA application for store customers to collect purchase stamps, track rewards, and redeem free gifts.

---

## 🚀 Quick Launch
- **Local Web App:** [http://localhost:8085/customer/](http://localhost:8085/customer/)
- **Direct File:** Open `index.html` in any modern web browser.
- **Android APK:** Precompiled APK available in `/download/apks/LoyaltyPass-Customer.apk`.

---

## 📁 Folder Structure
```
customer/
├── index.html           # Main Customer Pass Application UI
├── manifest.json        # PWA Manifest (Loyalty Pass)
├── sw.js                # Service Worker for offline caching
├── favicon-64.png       # App Favicon
├── favicon.ico
├── favicon.png
├── favicon.svg
├── css/
│   └── style.css        # Premium styling with dark mode & gold luxury theme
├── js/
│   ├── app.js           # Core Customer Pass controller, auth & stamp logic
│   ├── audio.js         # Sound effects for stamps and gift unlocks
│   ├── supabase-client.js # Cloud database synchronization
│   └── vendor/
│       ├── supabase.min.js
│       ├── html5-qrcode.min.js
│       └── confetti.browser.min.js
├── icons/
│   ├── icon-192.png     # Android home screen icon (192x192)
│   └── icon-512.png     # Splash screen icon (512x512)
└── assets/
    ├── logo.png         # Brand logo
    └── store_bg.jpg     # Pass background art
```

---

## 🎯 Key Features
1. **Zero-Friction Authentication:**
   - Sign in with Phone number & 4-digit PIN.
   - New registration with 0 automatic free stamps (prevents unearned stamping).
   - Show / Hide password toggle icons.
   - Reset password workflow.

2. **6-Tick Loyalty Card:**
   - Dynamic 6-stamp card with gold ring animations.
   - Real-time stamp counter synced with Supabase cloud database.

3. **Store QR Scanner:**
   - Built-in camera scanner to scan the store counter standee QR code.
   - Automatic 2nd-visit fraud protection (requests counter confirmation for multiple scans in 1 day).

4. **Gift Unlocks & Redemption:**
   - At 6 stamps, full confetti celebration and gift redemption voucher are unlocked.
   - Cashier verification PIN for instant redemption at counter.

5. **PWA & Offline Ready:**
   - Installable on Android (Chrome "Install App" / "Add to Home screen").
   - Installable on iPhone/iPad (Safari "Add to Home screen").
