# 🎁 Golden Perks - Online Digital Loyalty Card App (6-Tick Reward System)

A modern, luxury Progressive Web App (PWA) for retail shops and cafes. Customers collect digital loyalty stamps upon each purchase by scanning the in-store QR code, unlocking an exclusive **Free Gift** upon collecting all **6 tick boxes**!

Now equipped with a full **Store Owner Admin Portal** displaying real-time customer loyalty analytics and **remaining tick boxes** for each customer.

---

## 📂 Three Separate Standalone Application Folders

The project is cleanly split into 3 independent, dedicated application directories:

| Folder | Application | URL | Features |
|---|---|---|---|
| [**`customer/`**](file:///c:/Users/SUGHAN%20RITHVIK%20K/Documents/NEW-LOYALTY-CARD/customer/) | **Customer Loyalty Pass** | [http://localhost:8085/customer/](http://localhost:8085/customer/) | 6-stamp card, member registration, QR scanner, gift vouchers, dark/gold luxury theme |
| [**`owner/`**](file:///c:/Users/SUGHAN%20RITHVIK%20K/Documents/NEW-LOYALTY-CARD/owner/) | **Store Owner Terminal** | [http://localhost:8085/owner/](http://localhost:8085/owner/) | Merchant dashboard, customer directory, +1 stamp counter, 2nd visit approval inbox, standee QR generator |
| [**`download/`**](file:///c:/Users/SUGHAN%20RITHVIK%20K/Documents/NEW-LOYALTY-CARD/download/) | **Download & App Hub** | [http://localhost:8085/download/](http://localhost:8085/download/) | Dual-panel APK download links, web launchers, QR codes, Android & iOS installation guides |

---

## 🌟 How the 6-Tick Loyalty System Works

### 1. Customer Workflow
1. **Store Arrival & App Access**: Customer arrives at the shop, scans the store counter QR code.
2. **PWA Download**: Fast *"Install Loyalty Pass / Add to Home Screen"* prompt saves the app directly to Android / iPhone without app store downloads.
3. **Registration & Login**: Customer signs up or logs in using their **Mobile Number**, **Full Name**, and **Password**.
4. **Digital Pass with 6 Tick Boxes**:
   - **Slots 1, 2, 3, 4, 5**: Standard stamp ticks with sound effects and checkmarks.
   - **Slot 6 (The Gift Box 🎁)**: Unlocks on the **6th stamp**, triggering celebratory fanfare, fireworks confetti, and the Gift Claim Voucher!
5. **Scan Store QR**: Customer taps **"Scan Store QR to Stamp"**, scans the counter QR, and earns 1 tick per visit.
6. **Redeem Gift**: Cashier verifies the 6-digit claim code (`GIFT-XXXX-XX`), hands over the gift, and the card resets to **0/6** for the customer's next reward cycle!

---

## 👑 Store Owner Login & Customer Management Portal

### How the Store Owner Uses the Portal:
1. Tap the **"👑 Store Owner Portal"** button in the top navigation header (or choose the *Store Owner* tab on the login screen).
2. **Credentials**:
   - **Username**: `admin`
   - **Password**: `admin123`
   *(Or click **"⚡ One-Click Store Owner Login"** for instant access).*
3. **Owner Dashboard Features**:
   - **Key Metrics**:
     - Total Registered Customers
     - Customers Ready to Claim Gift (6/6 Ticks - 0 Remaining)
     - Customers 1 Tick Away (5/6 Ticks)
     - Total Gifts Redeemed
   - **Customer Directory & Remaining Tick Tracker**:
     - Shows **every customer** with their phone number, member ID, and current progress (e.g. `5 of 6 Ticks`).
     - **Prominent Remaining Ticks Badges**:
       - `🎉 0 TICKS REMAINING - READY FOR GIFT!` (for 6/6 ticks)
       - `⚡ 1 TICK REMAINING (1 purchase left!)` (for 5/6 ticks)
       - `X TICKS REMAINING` (for 2–5 ticks)
       - `6 TICKS REMAINING (New Customer)`
     - **Visual Mini 6-Slot Dots**: Quick visual indicator of the 5 ticks and 6th gift box for each customer.
     - **Quick Actions**:
       - **`+1 Stamp`**: Cashier/Owner can directly grant a stamp tick with 1 tap.
       - **`🎁 Handover Gift`**: Directly redeem the gift and reset the card for customers with 6/6 ticks.
     - **Search & Filter Tabs**: Filter by *All Customers*, *Ready for Gift (0 Left)*, *1 Tick Remaining*, or search by name/mobile.
     - **Counter Register Form**: Register new customers right at the counter.

---

## 🚀 How to Run Locally

The local web server runs at:
👉 **`http://localhost:8085`** *(also automatically listens on `http://localhost:8080`)*

- **Double-click launcher:** Double-click [`start-server.bat`](file:///c:/Users/SUGHAN%20RITHVIK%20K/Documents/NEW-LOYALTY-CARD/start-server.bat)
- **Or run via PowerShell:**
```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```

---

## ⚡ Instant Test Accounts
* **Customer Test**: Click **"⚡ One-Click Demo Customer"** on the login screen to sign in as **Sughan Rithvik** with **5 out of 6 ticks collected (1 tick remaining)** to test the 6th stamp gift unlock immediately!
* **Store Owner Test**: Click **"👑 Store Owner Portal"** -> **"⚡ One-Click Store Owner Login"** to inspect customer tick tracking and remaining boxes.
