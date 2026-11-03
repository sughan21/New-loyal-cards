import UIKit
import WebKit
import AVFoundation

class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {

    private var webView: WKWebView!
    private var progressView: UIProgressView!
    private var progressObservation: NSKeyValueObservation?
    private var pendingUrlToLoad: URL?

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .darkContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .white

        setupWebView()
        setupProgressBar()
        loadApplication()
    }

    private func setupWebView() {
        let userContentController = WKUserContentController()

        // Prepare device info
        let rawDeviceName = UIDevice.current.name.replacingOccurrences(of: "\"", with: "\\\"")
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        let model = UIDevice.current.model.replacingOccurrences(of: "\"", with: "\\\"")
        let iosVersion = "iOS " + UIDevice.current.systemVersion

        // Bridge Injection script for both IosBridge and AndroidBridge
        let bridgeScriptSource = """
        (function() {
            var bridge = {
                getUserDeviceName: function() { return "\(rawDeviceName)"; },
                getDeviceId: function() { return "\(deviceId)"; },
                getDeviceName: function() { return "\(model)"; },
                getIosVersion: function() { return "\(iosVersion)"; }
            };
            window.IosBridge = bridge;
            if (!window.AndroidBridge) {
                window.AndroidBridge = bridge;
            }
        })();
        """

        let userScript = WKUserScript(
            source: bridgeScriptSource,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        userContentController.addUserScript(userScript)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = userContentController
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.bounces = true
        webView.backgroundColor = .white
        webView.isOpaque = false

        view.addSubview(webView)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func setupProgressBar() {
        progressView = UIProgressView(progressViewStyle: .bar)
        progressView.translatesAutoresizingMaskIntoConstraints = false
        progressView.progressTintColor = UIColor(red: 184/255.0, green: 119/255.0, blue: 55/255.0, alpha: 1.0) // Gold
        progressView.trackTintColor = .clear
        view.addSubview(progressView)

        NSLayoutConstraint.activate([
            progressView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progressView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progressView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progressView.heightAnchor.constraint(equalToConstant: 3)
        ])

        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] (_, change) in
            guard let self = self, let progress = change.newValue else { return }
            self.progressView.progress = Float(progress)
            if progress >= 1.0 {
                UIView.animate(withDuration: 0.3, delay: 0.2, options: .curveEaseOut, animations: {
                    self.progressView.alpha = 0
                }) { _ in
                    self.progressView.progress = 0
                }
            } else {
                self.progressView.alpha = 1.0
            }
        }
    }

    private func loadApplication(customParam: String? = nil) {
        // Look for bundled web files in www folder
        if let wwwFolder = Bundle.main.url(forResource: "www", withExtension: nil) {
            var indexUrl = wwwFolder.appendingPathComponent("index.html")
            if let customParam = customParam, !customParam.isEmpty {
                if var components = URLComponents(url: indexUrl, resolvingAgainstBaseURL: false) {
                    components.query = customParam
                    if let newUrl = components.url {
                        indexUrl = newUrl
                    }
                }
            }
            webView.loadFileURL(indexUrl, allowingReadAccessTo: wwwFolder)
            return
        }

        // Fallback: Check root bundle for index.html
        if let directIndex = Bundle.main.url(forResource: "index", withExtension: "html") {
            let directory = directIndex.deletingLastPathComponent()
            webView.loadFileURL(directIndex, allowingReadAccessTo: directory)
            return
        }

        // If local files not bundled, load hosted fallback URL
        if let fallbackUrl = URL(string: "https://ended-degree-forest-vessels.trycloudflare.com") {
            webView.load(URLRequest(url: fallbackUrl))
        }
    }

    func handleCustomUrl(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let queryString = components.query ?? ""
        loadApplication(customParam: queryString)
    }

    // MARK: - WKUIDelegate Camera Permissions (iOS 15+)
    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }

    // MARK: - WKNavigationDelegate
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Injected completion hook
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("WebView navigation failed: \(error.localizedDescription)")
    }

    deinit {
        progressObservation?.invalidate()
    }
}
