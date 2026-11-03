# 📲 Download & App Hub (`/download`)

The centralized download portal and installation hub for both the Customer Loyalty Pass and Store Owner Cashier Terminal.

---

## 🚀 Quick Launch
- **Local Download Portal:** [http://localhost:8085/download/](http://localhost:8085/download/)
- **Direct File:** Open `index.html` in any web browser.

---

## 📁 Folder Structure
```
download/
├── index.html           # Dual-App Download Hub & Installation Instructions
├── apks/
│   ├── LoyaltyPass-Customer.apk  # Precompiled Android APK for Customers (10.6 MB)
│   └── StoreTerminal-Owner.apk   # Precompiled Android APK for Cashiers (10.6 MB)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── owner-icon-192.png
│   └── owner-icon-512.png
├── assets/
│   └── logo.png
└── favicon-64.png, favicon.ico, etc.
```

---

## 📱 What's Included
1. **Customer Pass Panel (`[ 👤 Customer Pass ]`):**
   - Direct download button for `LoyaltyPass-Customer.apk`.
   - Web Pass button opening `/customer/`.
   - Android APK install step-by-step accordion.
   - iOS iPhone/iPad Safari "Add to Home screen" guide (auto-detected on iOS devices).
   - Instant QR code to scan from mobile.

2. **Store Owner Terminal Panel (`[ 🏪 Store Terminal ]`):**
   - Direct download button for `StoreTerminal-Owner.apk`.
   - Store Terminal Web launch button opening `/owner/`.
   - Security notes, default credentials (`owner` / `owner123`), and cashier PIN (`1234`).
