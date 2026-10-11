package studio.junoh.phonetwin;

import org.json.*;
import java.io.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import okio.BufferedSink;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * Uploads one scan (PLY + meta JSON) and the updated scans/index.json to a GitHub repository as a single
 * commit, using the Git Data API (PROTOCOL.md §2). Blocking; call from a background thread.
 */
final class GitHubUploader {
    static final class Failure extends IOException { Failure(String m) { super(m); } }

    private final String repo, branch, token;
    GitHubUploader(String repo, String branch, String token) { this.repo = repo.trim(); this.branch = branch.trim(); this.token = token.trim(); }

    /** Scan id = file name without extension, limited to characters that are safe in URLs and file names. */
    static String scanId(String name) {
        int dot = name.lastIndexOf('.'); String s = dot > 0 ? name.substring(0, dot) : name;
        s = s.replaceAll("[^A-Za-z0-9_-]", "_");
        return s.isEmpty() ? "scan" : s;
    }

    /** New index with the entry first; an older entry with the same id is replaced. */
    static JSONObject mergeIndex(String existing, JSONObject entry) throws JSONException {
        JSONArray out = new JSONArray(); out.put(entry);
        if (existing != null && !existing.trim().isEmpty()) {
            JSONArray old = new JSONObject(existing).optJSONArray("scans");
            for (int i = 0; old != null && i < old.length(); i++) {
                JSONObject e = old.optJSONObject(i);
                if (e != null && !entry.getString("id").equals(e.optString("id"))) out.put(e);
            }
        }
        return new JSONObject().put("version", 1).put("scans", out);
    }

    /** Uploads; returns the new commit sha. progress receives short Korean status lines. */
    String upload(String id, File ply, JSONObject meta, JSONObject entry, Progress progress) throws IOException, JSONException {
        if (!repo.matches("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")) throw new Failure("저장소 이름은 owner/name 형식이어야 합니다");
        if (token.isEmpty()) throw new Failure("GitHub 토큰이 없습니다");
        IOException last = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try { return once(id, ply, meta, entry, progress); }
            catch (Conflict c) { last = c; progress.on("다른 커밋과 겹쳐 다시 시도합니다"); }
        }
        throw last;
    }
    interface Progress { void on(String s); }
    private static final class Conflict extends IOException { Conflict(String m) { super(m); } }

    private String once(String id, File ply, JSONObject meta, JSONObject entry, Progress progress) throws IOException, JSONException {
        progress.on("GitHub 확인 중…");
        Resp ref = call("GET", "/git/ref/heads/" + branch, null, false);
        if (ref.code == 404 || ref.code == 409) {
            Resp r = call("GET", "", null, false);
            if (r.code == 404) throw new Failure("저장소를 찾을 수 없습니다 (" + repo + ") · 이름과 토큰 권한을 확인하세요");
            throw new Failure("브랜치 '" + branch + "'가 없거나 저장소가 비어 있습니다 · GitHub에서 첫 커밋(README 등)을 먼저 만드세요");
        }
        ok(ref, "브랜치 읽기");
        String head = new JSONObject(ref.body).getJSONObject("object").getString("sha");
        Resp commit = ok(call("GET", "/git/commits/" + head, null, false), "커밋 읽기");
        String baseTree = new JSONObject(commit.body).getJSONObject("tree").getString("sha");

        progress.on(String.format(java.util.Locale.US, "PLY 업로드 중… (%.1f MB)", ply.length()/1048576.0));
        Resp blob = ok(blob(ply), "PLY 업로드");
        String plySha = new JSONObject(blob.body).getString("sha");

        Resp idx = call("GET", "/contents/scans/index.json?ref=" + branch, null, true);
        if (idx.code != 200 && idx.code != 404) ok(idx, "index.json 읽기");
        JSONObject index = mergeIndex(idx.code == 200 ? idx.body : null, entry);

        JSONArray tree = new JSONArray()
            .put(new JSONObject().put("path", "scans/" + id + ".ply").put("mode", "100644").put("type", "blob").put("sha", plySha))
            .put(new JSONObject().put("path", "scans/" + id + ".json").put("mode", "100644").put("type", "blob").put("content", meta.toString(2)))
            .put(new JSONObject().put("path", "scans/index.json").put("mode", "100644").put("type", "blob").put("content", index.toString(2)));
        progress.on("커밋 만드는 중…");
        Resp t = ok(call("POST", "/git/trees", new JSONObject().put("base_tree", baseTree).put("tree", tree).toString(), false), "트리 생성");
        String treeSha = new JSONObject(t.body).getString("sha");
        Resp c = ok(call("POST", "/git/commits", new JSONObject().put("message", "Add scan " + id).put("tree", treeSha)
            .put("parents", new JSONArray().put(head)).toString(), false), "커밋 생성");
        String sha = new JSONObject(c.body).getString("sha");
        Resp u = call("PATCH", "/git/refs/heads/" + branch, new JSONObject().put("sha", sha).put("force", false).toString(), false);
        if (u.code == 422 || u.code == 409) throw new Conflict("브랜치가 그 사이에 바뀌었습니다");
        ok(u, "브랜치 갱신");
        return sha;
    }

    // ------------------------------------------------------------------ HTTP (OkHttp: HttpURLConnection has no PATCH)
    private static final class Resp { int code; String body = ""; }
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).writeTimeout(180, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build();

    private Resp call(String method, String path, String body, boolean raw) throws IOException {
        return send(method, path, body == null ? null : RequestBody.create(JSON, body), raw);
    }
    private Resp send(String method, String path, RequestBody body, boolean raw) throws IOException {
        Request q = new Request.Builder().url("https://api.github.com/repos/" + repo + path).method(method, body)
            .header("Authorization", "Bearer " + token)
            .header("Accept", raw ? "application/vnd.github.raw" : "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28").header("User-Agent", "PhoneTwin-v4").build();
        try (Response r = client.newCall(q).execute()) {
            Resp o = new Resp(); o.code = r.code(); ResponseBody b = r.body(); o.body = b == null ? "" : b.string(); return o;
        }
    }
    /** POST /git/blobs streaming the file as base64 so a 10+ MB scan never sits in memory as one string. */
    private Resp blob(final File f) throws IOException {
        final byte[] pre = "{\"encoding\":\"base64\",\"content\":\"".getBytes(StandardCharsets.US_ASCII), post = "\"}".getBytes(StandardCharsets.US_ASCII);
        final long len = pre.length + 4*((f.length() + 2)/3) + post.length;
        RequestBody body = new RequestBody() {
            @Override public MediaType contentType() { return JSON; }
            @Override public long contentLength() { return len; }
            @Override public void writeTo(BufferedSink sink) throws IOException {
                sink.write(pre);
                OutputStream raw = new FilterOutputStream(sink.outputStream()) { @Override public void close() throws IOException { flush(); } };
                try (InputStream in = new BufferedInputStream(new FileInputStream(f), 1 << 16); OutputStream enc = Base64.getEncoder().wrap(raw)) {
                    byte[] buf = new byte[3 << 14]; for (int k; (k = in.read(buf)) > 0; ) enc.write(buf, 0, k);
                }                                 // closing the encoder writes the base64 tail; the sink stays open
                sink.write(post);
            }
        };
        return send("POST", "/git/blobs", body, false);
    }
    private static Resp ok(Resp r, String what) throws Failure {
        if (r.code >= 200 && r.code < 300) return r;
        String msg = r.body;
        try { msg = new JSONObject(r.body).optString("message", r.body); } catch (Exception ignored) {}
        if (r.code == 401) throw new Failure(what + " 실패: 토큰이 잘못되었거나 만료되었습니다");
        if (r.code == 403) throw new Failure(what + " 실패: 토큰에 이 저장소의 Contents 쓰기 권한이 없습니다 (" + msg + ")");
        throw new Failure(what + " 실패 (HTTP " + r.code + "): " + (msg.length() > 160 ? msg.substring(0, 160) : msg));
    }
}
