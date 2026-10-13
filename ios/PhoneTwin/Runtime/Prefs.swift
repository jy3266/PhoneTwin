import Foundation
import Security

/// Settings (same keys and defaults as the Android app). The UI writes them with @AppStorage; the AR,
/// feedback and link threads read them here (UserDefaults is thread-safe).
enum Prefs {
    private static var d: UserDefaults { .standard }
    private static func f(_ k: String, _ def: Float) -> Float { (d.object(forKey: k) as? NSNumber)?.floatValue ?? def }
    private static func b(_ k: String, _ def: Bool) -> Bool { d.object(forKey: k) as? Bool ?? def }

    // scanning
    static var scanRange: Float { f("scanrange2", 5) }
    static var scanVoxel: Float { f("scanvoxel3", 0.015) }
    static var scanConf: Float { f("scanconf", 0.6) }
    static var scanHits: Int { Int(f("scanhits", 2).rounded()) }
    // alignment
    static var useScale: Bool { b("scale", false) }
    static var zUp: Bool { get { b("zup", false) } set { d.set(newValue, forKey: "zup") } }
    // walking test
    static var walkRange: Float { f("walkrange", 0.6) }
    static var lookAhead: Float { f("lookahead", 1.5) }
    static var bodyHalf: Float { f("bodyhalf", 0.25) }
    static var walkContact: Float { f("walkcontact", 0.2) }
    static var obstacleTop: Float { f("obstop", 1.9) }
    // sounds and vibration
    static var soundOn: Bool { b("aisound", true) }
    static var soundRange: Float { f("soundrange", 4) }
    static var vibe: Bool { b("vibe", true) }
    static var tone: Bool { b("tone", false) }
    static var useUnrealHaptic: Bool { b("ue_haptic", true) }
    // GitHub
    static var ghAuto: Bool { b("gh_auto", false) }
    static var ghRepo: String { d.string(forKey: "gh_repo") ?? "jy3266/PhoneTwin" }
    static var ghBranch: String { d.string(forKey: "gh_branch") ?? "main" }
    // current scan
    static var scanName: String { get { d.string(forKey: "scan_name") ?? "scan.ply" } set { d.set(newValue, forKey: "scan_name") } }
    static var scanExt: String { get { d.string(forKey: "scan_ext") ?? "ply" } set { d.set(newValue, forKey: "scan_ext") } }
    static var scanCreated: String? { get { d.string(forKey: "scan_created") } set { d.set(newValue, forKey: "scan_created") } }
    static var scanData: ScanData { get { ScanData.parse(d.string(forKey: "scan_data") ?? "{}") } set { d.set(newValue.json(), forKey: "scan_data") } }
    static func soundName(_ key: String) -> String { d.string(forKey: "sound_" + key) ?? "" }
    static func setSoundName(_ key: String, _ name: String) { d.set(name, forKey: "sound_" + key) }

    static func now() -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXX"
        return f.string(from: Date())
    }
}

/// Secrets (GitHub token, relay key) live in the Keychain, only on this phone.
enum Keychain {
    static func get(_ key: String) -> String {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "phonetwin.v4", kSecAttrAccount as String: key,
                                kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return "" }
        return String(decoding: data, as: UTF8.self)
    }
    static func set(_ key: String, _ value: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "phonetwin.v4", kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        if value.isEmpty { return }
        var add = base; add[kSecValueData as String] = Data(value.utf8); add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}
