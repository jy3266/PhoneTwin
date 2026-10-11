package studio.junoh.phonetwin;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.RectF;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.tasks.components.containers.Category;
import com.google.mediapipe.tasks.components.containers.Detection;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector;
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetectorResult;
import java.util.*;
import java.util.concurrent.*;

/**
 * On-device object recognition (MediaPipe ObjectDetector, EfficientDet-Lite2, 80 COCO classes) on one
 * background thread. Each detection becomes a few 3D rays through its box, expressed in the scan frame,
 * which the caller intersects with the scan to place the object.
 */
final class Detector {
    static final String MODEL = "efficientdet_lite2.tflite";

    /** One camera frame copied off the GL thread. */
    static final class Job {
        byte[] y, u, v; int w, h, yRow, yPix, uvRow, uvPix;
        float fx, fy, cx, cy;      // CPU image intrinsics, pixels
        float[] camToS;            // ARCore camera pose frame -> scan frame
        int rotation;              // clockwise degrees to make the image upright
        boolean pending;           // taken while scanning: resolve once the scan index exists
    }

    static final class Obs {
        final String label; final float score, angle; final float[] rays;   // rays: n x {ox,oy,oz,dx,dy,dz}
        Obs(String label, float score, float angle, float[] rays) { this.label = label; this.score = score; this.angle = angle; this.rays = rays; }
    }

    interface Listener { void onResult(Job job, List<Obs> obs); }

    private final Context context; private final Listener listener;
    private final ExecutorService exec = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "ai-detector"); t.setDaemon(true); return t; });
    private volatile boolean busy = false, failed = false;
    private ObjectDetector detector;           // detector thread only
    volatile float minScore = .5f;
    volatile String status = "AI 인식: 대기";
    volatile String lastSeen = "";

    Detector(Context context, Listener listener) { this.context = context.getApplicationContext(); this.listener = listener; }

    boolean available() { return !busy && !failed; }

    void submit(Job j) {
        busy = true;
        exec.execute(() -> { try { run(j); } catch (Throwable t) { status = "AI 인식 오류: " + t.getClass().getSimpleName(); } finally { busy = false; } });
    }

    void shutdown() { exec.execute(() -> { if (detector != null) detector.close(); detector = null; }); exec.shutdown(); }

    private void run(Job j) {
        if (detector == null) {
            try {
                ObjectDetector.ObjectDetectorOptions o = ObjectDetector.ObjectDetectorOptions.builder()
                    .setBaseOptions(BaseOptions.builder().setModelAssetPath(MODEL).build())
                    .setRunningMode(RunningMode.IMAGE).setMaxResults(12).setScoreThreshold(.3f).build();
                detector = ObjectDetector.createFromOptions(context, o);
            } catch (Throwable t) { failed = true; status = "AI 모델을 불러오지 못했습니다: " + t.getMessage(); return; }
        }
        int rw = CameraGeometry.rotatedWidth(j.rotation, j.w, j.h), rh = j.w*j.h/rw;
        int[] argb = CameraGeometry.yuvToArgb(j.y, j.u, j.v, j.w, j.h, j.yRow, j.yPix, j.uvRow, j.uvPix, j.rotation);
        Bitmap bmp = Bitmap.createBitmap(argb, rw, rh, Bitmap.Config.ARGB_8888);
        long t0 = System.nanoTime();
        ObjectDetectorResult result = detector.detect(new BitmapImageBuilder(bmp).build());
        long ms = (System.nanoTime() - t0)/1_000_000;
        bmp.recycle();
        List<Obs> out = new ArrayList<>(); StringBuilder seen = new StringBuilder();
        float min = minScore;
        for (Detection d : result.detections()) {
            if (d.categories().isEmpty()) continue;
            Category c = d.categories().get(0);
            if (c.score() < min || c.categoryName() == null) continue;
            RectF b = d.boundingBox();
            float bx = b.centerX(), by = b.centerY(), bw = b.width(), bh = b.height();
            float[][] samples = {{bx, by}, {bx - .2f*bw, by}, {bx + .2f*bw, by}, {bx, by - .2f*bh}, {bx, by + .2f*bh}};
            float[] rays = new float[samples.length*6];
            for (int k = 0; k < samples.length; k++) {
                float[] s = CameraGeometry.toSensor(samples[k][0], samples[k][1], j.rotation, j.w, j.h);
                System.arraycopy(CameraGeometry.ray(s[0], s[1], j.fx, j.fy, j.cx, j.cy, j.camToS), 0, rays, k*6, 6);
            }
            out.add(new Obs(c.categoryName(), c.score(), bw/j.fx, rays));
            seen.append(AiObjects.korean(c.categoryName())).append(String.format(Locale.US, " %.0f%%  ", c.score()*100));
        }
        status = "AI 인식 동작 중 · " + ms + "ms/장";
        lastSeen = seen.toString();
        listener.onResult(j, out);
    }
}
