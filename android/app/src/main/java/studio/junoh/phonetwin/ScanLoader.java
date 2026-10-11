package studio.junoh.phonetwin;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.*;

/**
 * Loads a 3D scan as a point cloud in the internal "scan frame":
 * right-handed, Y up, metres, shifted so the first point is near (0,0,0).
 * Supports PLY (ascii / binary LE / binary BE, incl. Gaussian-splat f_dc colours),
 * OBJ vertices, and XYZ/PTS/TXT/CSV text clouds. Pure Java (unit-testable on the JVM).
 */
final class ScanLoader {
    static final int MAX_POINTS = 600_000;

    static final class Cloud {
        final float[] xyz; final byte[] rgb; final int n; final String info;
        final float[] min = {Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE};
        final float[] max = {-Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE};
        Cloud(float[] xyz, byte[] rgb, int n, String info) {
            this.xyz = xyz; this.rgb = rgb; this.n = n; this.info = info;
            for (int i = 0; i < n; i++) for (int k = 0; k < 3; k++) {
                float v = xyz[i*3+k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v;
            }
        }
        float[] center() { return new float[]{(min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2}; }
        float extent() { return Math.max(max[0]-min[0], Math.max(max[1]-min[1], max[2]-min[2])); }
    }

    static boolean supported(String ext) {
        return Arrays.asList("ply", "obj", "xyz", "pts", "txt", "csv").contains(ext);
    }

    static Cloud load(File file, String ext, boolean zUp) throws IOException {
        ext = ext.toLowerCase(Locale.ROOT);
        if (ext.equals("ply")) {
            try (InputStream in = new BufferedInputStream(new FileInputStream(file), 1 << 20)) { return ply(in, zUp); }
        }
        if (supported(ext)) return text(file, ext.equals("obj"), zUp);
        throw new IOException("지원하지 않는 형식: ." + ext);
    }

    /** Accumulates points with sub-sampling already decided by the caller. */
    private static final class Sink {
        final float[] xyz; final byte[] rgb; final boolean zUp; int n = 0; boolean colour = false;
        double ox, oy, oz; boolean hasOrigin = false;
        Sink(int capacity, boolean zUp) { xyz = new float[capacity*3]; rgb = new byte[capacity*3]; this.zUp = zUp; }
        void add(double x, double y, double z, float r, float g, float b) {
            if (n*3 >= xyz.length || !Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) return;
            if (zUp) { double t = y; y = z; z = -t; }
            if (!hasOrigin) { ox = x; oy = y; oz = z; hasOrigin = true; }
            xyz[n*3] = (float)(x-ox); xyz[n*3+1] = (float)(y-oy); xyz[n*3+2] = (float)(z-oz);
            if (r >= 0) { colour = true; rgb[n*3] = c8(r); rgb[n*3+1] = c8(g); rgb[n*3+2] = c8(b); }
            n++;
        }
        Cloud finish(String info) throws IOException {
            if (n == 0) throw new IOException("점 데이터를 찾지 못했습니다");
            Cloud c = new Cloud(xyz, rgb, n, info);
            if (!colour) heightColours(c);
            return c;
        }
    }

    private static byte c8(float v) { return (byte)Math.round(Math.max(0, Math.min(1, v))*255); }

    /** Height gradient for scans without colour: floor blue → ceiling warm. */
    static void heightColours(Cloud c) {
        float lo = c.min[1], span = Math.max(1e-3f, c.max[1]-lo);
        for (int i = 0; i < c.n; i++) {
            float t = (c.xyz[i*3+1]-lo)/span;
            c.rgb[i*3] = c8(.25f+.7f*t); c.rgb[i*3+1] = c8(.55f+.3f*(1-Math.abs(t-.5f)*2)); c.rgb[i*3+2] = c8(.95f-.6f*t);
        }
    }

    private static int stepFor(long count) { return (int)Math.max(1, (count + MAX_POINTS - 1) / MAX_POINTS); }

    // ---------------------------------------------------------------- PLY
    private static String headerLine(InputStream in) throws IOException {
        StringBuilder b = new StringBuilder();
        for (int c; (c = in.read()) != '\n'; ) {
            if (c < 0) throw new IOException("PLY 헤더가 끝나지 않았습니다");
            if (c != '\r') b.append((char)c);
            if (b.length() > 4096) throw new IOException("PLY 헤더가 너무 깁니다");
        }
        return b.toString().trim();
    }

    private static int size(String t) throws IOException {
        switch (t) {
            case "char": case "uchar": case "int8": case "uint8": return 1;
            case "short": case "ushort": case "int16": case "uint16": return 2;
            case "int": case "uint": case "int32": case "uint32": case "float": case "float32": return 4;
            case "double": case "float64": return 8;
        }
        throw new IOException("알 수 없는 PLY 형식: " + t);
    }

    /** Scale to 0..1 for colour channels stored as integers. */
    private static float colourScale(String t) {
        switch (t) {
            case "char": case "uchar": case "int8": case "uint8": return 1f/255;
            case "short": case "ushort": case "int16": case "uint16": return 1f/65535;
            default: return 1f;
        }
    }

    private static double read(ByteBuffer b, String t, int off) {
        switch (t) {
            case "char": case "int8": return b.get(off);
            case "uchar": case "uint8": return b.get(off) & 0xff;
            case "short": case "int16": return b.getShort(off);
            case "ushort": case "uint16": return b.getShort(off) & 0xffff;
            case "int": case "int32": return b.getInt(off);
            case "uint": case "uint32": return b.getInt(off) & 0xffffffffL;
            case "float": case "float32": return b.getFloat(off);
            default: return b.getDouble(off);
        }
    }

    static Cloud ply(InputStream in, boolean zUp) throws IOException {
        if (!headerLine(in).equals("ply")) throw new IOException("PLY 파일이 아닙니다");
        String format = null; long count = -1; boolean vertexSeen = false, inVertex = false;
        List<String> types = new ArrayList<>(), names = new ArrayList<>();
        for (String line; !(line = headerLine(in)).equals("end_header"); ) {
            String[] t = line.split("\\s+");
            if (t[0].equals("format")) format = t[1];
            else if (t[0].equals("element")) {
                inVertex = t[1].equals("vertex");
                if (inVertex) { count = Long.parseLong(t[2]); vertexSeen = true; }
                else if (!vertexSeen) throw new IOException("vertex 요소가 첫 번째가 아닌 PLY는 지원하지 않습니다");
            } else if (t[0].equals("property") && inVertex) {
                if (t[1].equals("list")) throw new IOException("vertex 안의 list 속성은 지원하지 않습니다");
                types.add(t[1]); names.add(t[2]);
            }
        }
        if (format == null || count <= 0) throw new IOException("PLY vertex 정보가 없습니다");
        int ix = names.indexOf("x"), iy = names.indexOf("y"), iz = names.indexOf("z");
        if (ix < 0 || iy < 0 || iz < 0) throw new IOException("PLY에 x/y/z 속성이 없습니다");
        int ir = names.indexOf("red"), ig = names.indexOf("green"), ib = names.indexOf("blue");
        if (ir < 0) { ir = names.indexOf("diffuse_red"); ig = names.indexOf("diffuse_green"); ib = names.indexOf("diffuse_blue"); }
        int f0 = names.indexOf("f_dc_0"), f1 = names.indexOf("f_dc_1"), f2 = names.indexOf("f_dc_2");
        boolean rgb = ir >= 0 && ig >= 0 && ib >= 0, splat = !rgb && f0 >= 0 && f1 >= 0 && f2 >= 0;
        int step = stepFor(count);
        Sink sink = new Sink((int)Math.min(MAX_POINTS, (count + step - 1) / step), zUp);
        final double SH0 = 0.28209479177387814;

        if (format.equals("ascii")) {
            BufferedReader r = new BufferedReader(new InputStreamReader(in, "US-ASCII"), 1 << 16);
            for (long i = 0; i < count; i++) {
                String line = r.readLine(); if (line == null) break;
                if (i % step != 0) continue;
                String[] t = line.trim().split("\\s+");
                if (t.length < names.size()) continue;
                float cr = -1, cg = -1, cb = -1;
                if (rgb) { cr = Float.parseFloat(t[ir])*colourScale(types.get(ir)); cg = Float.parseFloat(t[ig])*colourScale(types.get(ig)); cb = Float.parseFloat(t[ib])*colourScale(types.get(ib)); }
                else if (splat) { cr = (float)(.5+SH0*Double.parseDouble(t[f0])); cg = (float)(.5+SH0*Double.parseDouble(t[f1])); cb = (float)(.5+SH0*Double.parseDouble(t[f2])); }
                sink.add(Double.parseDouble(t[ix]), Double.parseDouble(t[iy]), Double.parseDouble(t[iz]), cr, cg, cb);
            }
        } else {
            ByteOrder order;
            if (format.equals("binary_little_endian")) order = ByteOrder.LITTLE_ENDIAN;
            else if (format.equals("binary_big_endian")) order = ByteOrder.BIG_ENDIAN;
            else throw new IOException("알 수 없는 PLY format: " + format);
            int[] off = new int[types.size()]; int stride = 0;
            for (int i = 0; i < types.size(); i++) { off[i] = stride; stride += size(types.get(i)); }
            byte[] rec = new byte[stride]; ByteBuffer b = ByteBuffer.wrap(rec).order(order);
            DataInputStream d = new DataInputStream(in);
            for (long i = 0; i < count; i += step) {
                try { d.readFully(rec); } catch (EOFException e) { break; }
                float cr = -1, cg = -1, cb = -1;
                if (rgb) { cr = (float)read(b, types.get(ir), off[ir])*colourScale(types.get(ir)); cg = (float)read(b, types.get(ig), off[ig])*colourScale(types.get(ig)); cb = (float)read(b, types.get(ib), off[ib])*colourScale(types.get(ib)); }
                else if (splat) { cr = (float)(.5+SH0*read(b, types.get(f0), off[f0])); cg = (float)(.5+SH0*read(b, types.get(f1), off[f1])); cb = (float)(.5+SH0*read(b, types.get(f2), off[f2])); }
                sink.add(read(b, types.get(ix), off[ix]), read(b, types.get(iy), off[iy]), read(b, types.get(iz), off[iz]), cr, cg, cb);
                long skip = (long)stride*(Math.min(step, count-i)-1);
                while (skip > 0) { long s = d.skip(skip); if (s <= 0) { if (d.read() < 0) break; s = 1; } skip -= s; }
            }
        }
        return sink.finish(String.format(Locale.US, "PLY %s · 원본 %,d점 → %,d점%s", format, count, sink.n, splat ? " · 스플랫 색상" : ""));
    }

    // ---------------------------------------------------------------- OBJ / XYZ / PTS / CSV / TXT
    private static double[] numbers(String line, boolean obj) {
        line = line.trim();
        if (line.isEmpty()) return null;
        if (obj) { if (!line.startsWith("v ") && !line.startsWith("v\t")) return null; line = line.substring(2); }
        else if (line.charAt(0) == '#' || line.startsWith("//")) return null;
        String[] t = line.split("[\\s,;]+");
        if (t.length < 3) return null;
        double[] v = new double[Math.min(t.length, 8)];
        try { for (int i = 0; i < v.length; i++) v[i] = Double.parseDouble(t[i]); } catch (NumberFormatException e) { return null; }
        return v;
    }

    private static Cloud text(File file, boolean obj, boolean zUp) throws IOException {
        long count = 0;
        try (BufferedReader r = new BufferedReader(new FileReader(file), 1 << 16)) {
            for (String l; (l = r.readLine()) != null; ) if (numbers(l, obj) != null) count++;
        }
        if (count == 0) throw new IOException("점 데이터를 찾지 못했습니다");
        int step = stepFor(count);
        Sink sink = new Sink((int)Math.min(MAX_POINTS, (count + step - 1) / step), zUp);
        long i = 0;
        try (BufferedReader r = new BufferedReader(new FileReader(file), 1 << 16)) {
            for (String l; (l = r.readLine()) != null; ) {
                double[] v = numbers(l, obj); if (v == null) continue;
                if (i++ % step != 0) continue;
                float cr = -1, cg = -1, cb = -1;
                // OBJ: x y z [r g b] (0..1). Text clouds: x y z [i] r g b (0..1 or 0..255), colours are the last three.
                if (v.length >= 6) {
                    int c = obj ? 3 : v.length-3;
                    double k = (v[c] > 1 || v[c+1] > 1 || v[c+2] > 1) ? 1/255.0 : 1;
                    cr = (float)(v[c]*k); cg = (float)(v[c+1]*k); cb = (float)(v[c+2]*k);
                }
                sink.add(v[0], v[1], v[2], cr, cg, cb);
            }
        }
        return sink.finish(String.format(Locale.US, "%s · 원본 %,d점 → %,d점", obj ? "OBJ 정점" : "텍스트 점군", count, sink.n));
    }
}
