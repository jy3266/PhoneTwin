import Foundation

/// Scans on the GitHub repository (PROTOCOL.md §2): read the list / one scan back, and upload one scan
/// (PLY + meta JSON + updated scans/index.json) as a single commit with the Git Data API.
enum GitHub {
    struct Entry: Equatable { let id, ply, meta, created, device: String; let points: Int }

    /// Scan id = file name without extension, limited to characters that are safe in URLs and file names.
    static func scanId(_ name: String) -> String {
        var s = name
        if let dot = name.lastIndex(of: "."), dot > name.startIndex { s = String(name[..<dot]) }
        s = String(s.map { c -> Character in (c.isASCII && (c.isLetter || c.isNumber)) || c == "_" || c == "-" ? c : "_" })
        return s.isEmpty ? "scan" : s
    }

    /// Entries of index.json, newest first; ids that could escape the scans folder are dropped.
    static func parseIndex(_ json: Data) throws -> [Entry] {
        guard let root = try JSONSerialization.jsonObject(with: json) as? [String: Any] else { throw ScanError("index.json 형식 오류") }
        var out = [Entry]()
        for o in root["scans"] as? [[String: Any]] ?? [] {
            let id = o["id"] as? String ?? ""
            if id.isEmpty || id.contains("/") || id.contains("\\") || id.contains("..") { continue }
            out.append(Entry(id: id, ply: o["ply"] as? String ?? "scans/\(id).ply", meta: o["meta"] as? String ?? "scans/\(id).json",
                             created: o["created"] as? String ?? "", device: o["device"] as? String ?? "", points: (o["points"] as? NSNumber)?.intValue ?? 0))
        }
        return out
    }

    /// New index with the entry first; an older entry with the same id is replaced.
    static func mergeIndex(existing: Data?, entry: [String: Any]) -> [String: Any] {
        var scans: [[String: Any]] = [entry]
        if let d = existing, let root = try? JSONSerialization.jsonObject(with: d) as? [String: Any], let old = root["scans"] as? [[String: Any]] {
            for e in old where (e["id"] as? String) != (entry["id"] as? String) { scans.append(e) }
        }
        return ["version": 1, "scans": scans]
    }

    private static func floats(_ v: Any?) -> [Float]? {
        guard let a = v as? [Any], a.count >= 3 else { return nil }
        let f = a.compactMap { ($0 as? NSNumber)?.floatValue }
        return f.count >= 3 ? Array(f.prefix(3)) : nil
    }

    /// Converts an uploaded meta file into the app's saved scan data (a, b, objects, ai).
    static func toScanData(meta: Data) throws -> ScanData {
        guard let m = try JSONSerialization.jsonObject(with: meta) as? [String: Any] else { throw ScanError("meta 형식 오류") }
        var d = ScanData()
        if let a = floats(m["a"]), let b = floats(m["b"]) { d.a = a; d.b = b }
        for (i, o) in (m["objects"] as? [[String: Any]] ?? []).enumerated() {
            guard let c = floats(o["c"]) else { continue }
            d.objects.append(.init(id: (o["id"] as? NSNumber)?.intValue ?? i + 1, name: o["name"] as? String ?? "사물 \(i + 1)", c: c, r: (o["r"] as? NSNumber)?.floatValue ?? 0.25))
        }
        for o in m["ai"] as? [[String: Any]] ?? [] {
            guard let label = o["label"] as? String, let c = floats(o["c"]) else { continue }
            d.ai.append(.init(label: label, c: c, r: (o["r"] as? NSNumber)?.floatValue ?? 0.4, hits: AiLabels.confirm))
        }
        return d
    }

    // ------------------------------------------------------------------ HTTP
    private static let session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 120; c.timeoutIntervalForResource = 600
        return URLSession(configuration: c)
    }()

    private static func request(_ url: String, method: String = "GET", token: String, raw: Bool, body: Data? = nil) throws -> URLRequest {
        guard let u = URL(string: url) else { throw ScanError("잘못된 주소: \(url)") }
        var q = URLRequest(url: u); q.httpMethod = method
        q.setValue(raw ? "application/vnd.github.raw" : "application/vnd.github+json", forHTTPHeaderField: "Accept")
        q.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        q.setValue("PhoneTwin-v4-iOS", forHTTPHeaderField: "User-Agent")
        if !token.isEmpty { q.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let b = body { q.httpBody = b; q.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type") }
        return q
    }

    private static func send(_ q: URLRequest) async throws -> (Int, Data) {
        let (data, resp) = try await session.data(for: q)
        return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    // ------------------------------------------------------------------ reading (token optional for a public repository)
    struct Reader {
        let repo, branch, token: String
        init(repo: String, branch: String, token: String) {
            self.repo = repo.trimmingCharacters(in: .whitespaces)
            let b = branch.trimmingCharacters(in: .whitespaces); self.branch = b.isEmpty ? "main" : b
            self.token = token.trimmingCharacters(in: .whitespaces)
        }

        func list() async throws -> [Entry] { try GitHub.parseIndex(try await fetch("scans/index.json")) }

        /// GET a repository file through the contents API (never stale); falls back to raw.githubusercontent.com
        /// when the anonymous API limit (60 requests/hour) is used up.
        func fetch(_ path: String) async throws -> Data {
            let (code, data) = try await GitHub.send(try GitHub.request("https://api.github.com/repos/\(repo)/contents/\(path)?ref=\(branch)", token: token, raw: true))
            if (200..<300).contains(code) { return data }
            if code == 404 { throw ScanError("\(path) 이(가) \(repo) 에 없습니다") }
            if code == 401 { throw ScanError("GitHub 토큰이 잘못되었거나 만료되었습니다 (토큰 칸을 비우면 공개 저장소는 토큰 없이 읽습니다)") }
            if code != 403 && code != 429 { throw ScanError("GitHub 응답 \(code)") }
            let (c2, d2) = try await GitHub.send(try GitHub.request("https://raw.githubusercontent.com/\(repo)/\(branch)/\(path)", token: "", raw: true))
            if !(200..<300).contains(c2) { throw ScanError("GitHub 읽기 실패 (\(c2))") }
            return d2
        }
    }

    // ------------------------------------------------------------------ upload
    struct Uploader {
        let repo, branch, token: String
        init(repo: String, branch: String, token: String) {
            self.repo = repo.trimmingCharacters(in: .whitespaces)
            let b = branch.trimmingCharacters(in: .whitespaces); self.branch = b.isEmpty ? "main" : b
            self.token = token.trimmingCharacters(in: .whitespaces)
        }
        private struct Conflict: Error {}

        /// Uploads; returns the new commit sha. progress receives short Korean status lines.
        func upload(id: String, ply: URL, meta: [String: Any], entry: [String: Any], progress: @escaping (String) -> Void) async throws -> String {
            if repo.range(of: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", options: .regularExpression) == nil { throw ScanError("저장소 이름은 owner/name 형식이어야 합니다") }
            if token.isEmpty { throw ScanError("GitHub 토큰이 없습니다") }
            do { return try await once(id: id, ply: ply, meta: meta, entry: entry, progress: progress) }
            catch is Conflict { progress("다른 커밋과 겹쳐 다시 시도합니다") }
            do { return try await once(id: id, ply: ply, meta: meta, entry: entry, progress: progress) }
            catch is Conflict { throw ScanError("브랜치가 그 사이에 바뀌었습니다 · 다시 시도하세요") }
        }

        private func call(_ method: String, _ path: String, _ body: Any? = nil, raw: Bool = false) async throws -> (Int, Data) {
            let b = try body.map { try JSONSerialization.data(withJSONObject: $0) }
            return try await GitHub.send(try GitHub.request("https://api.github.com/repos/\(repo)\(path)", method: method, token: token, raw: raw, body: b))
        }
        private func ok(_ r: (Int, Data), _ what: String) throws -> [String: Any] {
            let (code, data) = r
            if (200..<300).contains(code) { return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:] }
            var msg = String(decoding: data, as: UTF8.self)
            if let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let m = j["message"] as? String { msg = m }
            if code == 401 { throw ScanError("\(what) 실패: 토큰이 잘못되었거나 만료되었습니다") }
            if code == 403 { throw ScanError("\(what) 실패: 토큰에 이 저장소의 Contents 쓰기 권한이 없습니다 (\(msg))") }
            throw ScanError("\(what) 실패 (HTTP \(code)): \(msg.prefix(160))")
        }

        private func once(id: String, ply: URL, meta: [String: Any], entry: [String: Any], progress: @escaping (String) -> Void) async throws -> String {
            progress("GitHub 확인 중…")
            let ref = try await call("GET", "/git/ref/heads/\(branch)")
            if ref.0 == 404 || ref.0 == 409 {
                let r = try await call("GET", "")
                if r.0 == 404 { throw ScanError("저장소를 찾을 수 없습니다 (\(repo)) · 이름과 토큰 권한을 확인하세요") }
                throw ScanError("브랜치 '\(branch)'가 없거나 저장소가 비어 있습니다 · GitHub에서 첫 커밋(README 등)을 먼저 만드세요")
            }
            guard let head = (try ok(ref, "브랜치 읽기")["object"] as? [String: Any])?["sha"] as? String else { throw ScanError("브랜치 읽기 실패") }
            guard let baseTree = (try ok(try await call("GET", "/git/commits/\(head)"), "커밋 읽기")["tree"] as? [String: Any])?["sha"] as? String else { throw ScanError("커밋 읽기 실패") }

            let plyData = try Data(contentsOf: ply)
            progress(String(format: "PLY 업로드 중… (%.1f MB)", Double(plyData.count)/1_048_576))
            guard let plySha = try ok(try await call("POST", "/git/blobs", ["encoding": "base64", "content": plyData.base64EncodedString()]), "PLY 업로드")["sha"] as? String else { throw ScanError("PLY 업로드 실패") }

            let idx = try await call("GET", "/contents/scans/index.json?ref=\(branch)", raw: true)
            if idx.0 != 200 && idx.0 != 404 { _ = try ok(idx, "index.json 읽기") }
            let index = GitHub.mergeIndex(existing: idx.0 == 200 ? idx.1 : nil, entry: entry)

            func pretty(_ o: Any) throws -> String { String(decoding: try JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]), as: UTF8.self) }
            let tree: [[String: Any]] = [
                ["path": "scans/\(id).ply", "mode": "100644", "type": "blob", "sha": plySha],
                ["path": "scans/\(id).json", "mode": "100644", "type": "blob", "content": try pretty(meta)],
                ["path": "scans/index.json", "mode": "100644", "type": "blob", "content": try pretty(index)]]
            progress("커밋 만드는 중…")
            guard let treeSha = try ok(try await call("POST", "/git/trees", ["base_tree": baseTree, "tree": tree]), "트리 생성")["sha"] as? String else { throw ScanError("트리 생성 실패") }
            guard let sha = try ok(try await call("POST", "/git/commits", ["message": "Add scan \(id)", "tree": treeSha, "parents": [head]]), "커밋 생성")["sha"] as? String else { throw ScanError("커밋 생성 실패") }
            let u = try await call("PATCH", "/git/refs/heads/\(branch)", ["sha": sha, "force": false])
            if u.0 == 422 || u.0 == 409 { throw Conflict() }
            _ = try ok(u, "브랜치 갱신")
            return sha
        }
    }
}
