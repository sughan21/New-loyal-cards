# 🍏 Loyalty Pass — iOS Application Project

Welcome to the native iOS application for **Loyalty Pass**.

This project provides both **Native Swift (WKWebView)** and **Instant Safari PWA** support for Apple devices (iPhone & iPad).

---

## 📱 Features on iOS

- **Native Device Name Detection**: Uses Apple's native `UIDevice.current.name` (reads the user's custom phone name, e.g., *"Sughan's iPhone"*).
- **Unique Hardware Device ID**: Uses Apple's `UIDevice.current.identifierForVendor` for persistent device tracking.
- **In-App Camera QR Scanner**: Full WKUIDelegate permissions configured with `NSCameraUsageDescription` to scan in-store standee QR codes without leaving the app.
- **Deep Linking**: Supports custom URL scheme `loyaltypass://scan?store_scan=XYZ`.
- **Offline & Bundled Assets**: Bundled within the app in `ios/LoyaltyReward/www/`.

---

## 🛠️ How to Build & Run the iOS App

### Method 1: Using Xcode on a Mac
1. Open the project in Xcode:
   ```bash
   open ios/LoyaltyReward.xcodeproj
   ```
2. In Xcode, select your target device (iPhone Simulator or your connected iPhone).
3. Under **Signing & Capabilities**, select your Apple Developer Account or Personal Team.
4. Press **Cmd + R** to run.

---

### Method 2: Cloud Build via GitHub Actions (No Mac Needed!)
If you are developing on Windows or do not have Xcode installed locally:
1. Push this project to GitHub.
2. Go to the **Actions** tab on your GitHub repository.
3. You will see the **Build iOS App** workflow (`.github/workflows/build-ios.yml`).
4. Click **Run workflow** (or simply push to `main`).
5. GitHub's Apple Silicon runners will compile the project using `xcodebuild` and produce `LoyaltyPass-iOS-unsigned.ipa` as a downloadable artifact.
6. You can sign and install the `.ipa` using tools like **Sideloadly**, **AltStore**, or your developer certificate.

---

### Method 3: Instant Safari Installation (1-Tap on iPhone / iPad)
Any iPhone customer or staff member can install the app directly in 10 seconds without needing an `.ipa` or App Store:
1. Open Safari on iPhone and visit your hosted link or `download.html`.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** in the top right.
5. The **Loyalty Pass** icon appears on the iPhone Home Screen and opens in full-screen standalone mode!

---

## 📂 Directory Structure

```
ios/
├── LoyaltyReward.xcodeproj/
│   └── project.pbxproj        # Xcode Project File
└── LoyaltyReward/
    ├── AppDelegate.swift       # Application lifecycle
    ├── SceneDelegate.swift     # Scene lifecycle & deep link routing
    ├── ViewController.swift    # Fullscreen WKWebView & Native Bridge
    ├── Info.plist              # Bundle ID, Camera description, URL schemes
    ├── LaunchScreen.storyboard # Native launch screen
    ├── Assets.xcassets/        # AppIcon & image catalog
    └── www/                    # Bundled web assets (HTML, CSS, JS, Supabase)
```
