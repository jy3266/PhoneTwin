package studio.junoh.phonetwin;

import java.io.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.*;

/**
 * Reads scans back from the GitHub repository (PROTOCOL.md §2): scans/index.json, then one scan's PLY + meta.
 * Uses the contents API (never stale; the token is optional for a public repository) and falls back to
 * raw.githubusercontent.com when the anonymous API limit (60 requests/hour) is used up.
 */
final class GitHubScans {
    static final class Entry {
        final String id, ply, meta, created, device; final long points;
        Entry(String id, String ply, String meta, String created, String device, long points) { this.id = id; this.ply = ply; this.meta = meta; this.created = created; this.device = device; this.points = points; }
    }

    private final String repo, branch, token;
    private final OkHttpClient client = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build();
    GitHubScans(String repo, String branch, String token) { this.repo = repo.trim(); this.branch = branch.trim().isEmpty() ? "main" : branch.trim(); this.token = token.trim(); }

    /** Entries of index.json, newest first; ids that could escape the scans folder are dropped. */
    static List<Entry> parseIndex(String json) throws JSONException {
        List<Entry> out = new ArrayList<>();
        JSONArray a = new JSONObject(json).optJSONArray("scans");
        for (int i = 0; a != null && i < a.length(); i++) {
            JSONObject o = a.optJSONObject(i); if (o == null) continue;
            String id = o.optString("id", "");
            if (id.isEmpty() || id.contains("/") || id.contains("\\") || id.contains("..")) continue;
            out.add(new Entry(id, o.optString("ply", "scans/" + id + ".ply"), o.optString("meta", "scans/" + id + ".json"),
                o.optString("created", ""), o.optString("device", ""), o.optLong("points", 0)));
        }
        return out;
    }

    /** Converts an uploaded meta file into the app's saved scan data (a, b, objects, ai). */
    static JSONObject toScanData(String metaJson) throws JSONException {
        JSONObject m = new JSONObject(metaJson), d = new JSONObject();
        JSONArray a = m.optJSONArray("a"), b = m.optJSONArray("b");
        if (a != null && b != null && a.length() >= 3 && b.length() >= 3) { d.put("a", a); d.put("b", b); }
        JSONArray objs = new JSONArray(), src = m.optJSONArray("objects");
        for (int i = 0; src != null && i < src.length(); i++) {
            JSONObject o = src.getJSONObject(i);
            objs.put(new JSONObject().put("id", o.optInt("id", i + 1)).put("name", o.optString("name", "사물 " + (i + 1))).put("c", o.getJSONArray("c")).put("r", o.optDouble("r", .25)));
        }
        JSONArray ais = new JSONArray(), srcAi = m.optJSONArray("ai");
        for (int i = 0; srcAi != null && i < srcAi.length(); i++) {
            JSONObject o = srcAi.getJSONObject(i);
            ais.put(new JSONObject().put("label", o.getString("label")).put("c", o.getJSONArray("c")).put("r", o.optDouble("r", .4)).put("hits", AiObjects.CONFIRM));
        }
        return d.put("objects", objs).put("ai", ais);
    }

    List<Entry> list() throws IOException, JSONException { return parseIndex(new String(fetch("scans/index.json", null), "UTF-8")); }

    /** The collision editor's file for a scan (web_scans/&lt;id&gt;.collision.json), or null when it has none. */
    String collisionJson(String id) throws IOException {
        try { return text("web_scans/" + id + ".collision.json"); }
        catch (FileNotFoundException none) { return null; }
    }
    /** name → git blob sha of the sound files in web_scans/sounds (one API call; empty when the folder does not exist). */
    Map<String, String> soundShas() throws IOException, JSONException {
        Request.Builder q = new Request.Builder().url("https://api.github.com/repos/" + repo + "/contents/web_scans/sounds?ref=" + branch)
            .header("Accept", "application/vnd.github+json").header("User-Agent", "PhoneTwin-v4").header("X-GitHub-Api-Version", "2022-11-28");
        if (!token.isEmpty()) q.header("Authorization", "Bearer " + token);
        Map<String, String> out = new HashMap<>();
        try (Response r = client.newCall(q.build()).execute()) {
            if (r.code() == 404) return out;
            if (!r.isSuccessful()) throw new IOException("GitHub 소리 목록 응답 " + r.code());
            JSONArray a = new JSONArray(r.body().string());
            for (int i = 0; i < a.length(); i++) { JSONObject o = a.getJSONObject(i); if ("file".equals(o.optString("type"))) out.put(o.getString("name"), o.getString("sha")); }
        }
        return out;
    }
    /** git's blob id of a file, to know whether the phone already has GitHub's version. */
    static String blobSha(File f) {
        try (InputStream in = new FileInputStream(f)) {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-1");
            md.update(("blob " + f.length() + "\0").getBytes("US-ASCII"));
            byte[] buf = new byte[1 << 16]; for (int k; (k = in.read(buf)) > 0; ) md.update(buf, 0, k);
            StringBuilder s = new StringBuilder(); for (byte b : md.digest()) s.append(String.format("%02x", b)); return s.toString();
        } catch (Exception e) { return ""; }
    }
    /** Downloads web_scans/sounds/&lt;name&gt; from the raw host (no API limit; names may be Korean or have spaces). */
    void downloadSound(String name, File dst) throws IOException {
        String url = "https://raw.githubusercontent.com/" + repo + "/" + branch + "/web_scans/sounds/" + java.net.URLEncoder.encode(name, "UTF-8").replace("+", "%20");
        Request.Builder q = new Request.Builder().url(url).header("User-Agent", "PhoneTwin-v4");
        if (!token.isEmpty()) q.header("Authorization", "Bearer " + token);
        File tmp = new File(dst.getPath() + ".part");
        try (Response r = client.newCall(q.build()).execute()) {
            if (!r.isSuccessful()) throw new IOException(name + " 받기 실패 (" + r.code() + ")");
            body(r, tmp);
        }
        if (dst.exists() && !dst.delete() || !tmp.renameTo(dst)) throw new IOException(name + " 저장 실패");
    }
    String text(String path) throws IOException { return new String(fetch(path, null), "UTF-8"); }
    void download(String path, File dst) throws IOException { fetch(path, dst); }

    /** GET a repository file; writes to dst (and returns null) or returns the bytes. */
    private byte[] fetch(String path, File dst) throws IOException {
        Request.Builder q = new Request.Builder().url("https://api.github.com/repos/" + repo + "/contents/" + path + "?ref=" + branch)
            .header("Accept", "application/vnd.github.raw").header("User-Agent", "PhoneTwin-v4").header("X-GitHub-Api-Version", "2022-11-28");
        if (!token.isEmpty()) q.header("Authorization", "Bearer " + token);
        try (Response r = client.newCall(q.build()).execute()) {
            if (r.isSuccessful()) return body(r, dst);
            if (r.code() == 404) throw new FileNotFoundException(path + "이(가) " + repo + " 에 없습니다");
            if (r.code() == 401) throw new IOException("GitHub 토큰이 잘못되었거나 만료되었습니다 (토큰 칸을 비우면 공개 저장소는 토큰 없이 읽습니다)");
            if (r.code() != 403 && r.code() != 429) throw new IOException("GitHub 응답 " + r.code());
        }
        // anonymous API limit used up: the raw host may lag a few minutes behind new uploads
        Request raw = new Request.Builder().url("https://raw.githubusercontent.com/" + repo + "/" + branch + "/" + path).header("User-Agent", "PhoneTwin-v4").build();
        try (Response r = client.newCall(raw).execute()) {
            if (r.code() == 404) throw new FileNotFoundException(path);
            if (!r.isSuccessful()) throw new IOException("GitHub 읽기 실패 (" + r.code() + ")");
            return body(r, dst);
        }
    }
    private static byte[] body(Response r, File dst) throws IOException {
        ResponseBody b = r.body(); if (b == null) throw new IOException("빈 응답");
        if (dst == null) return b.bytes();
        try (InputStream in = b.byteStream(); OutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[1 << 16]; for (int k; (k = in.read(buf)) > 0; ) out.write(buf, 0, k);
        }
        return null;
    }
}
