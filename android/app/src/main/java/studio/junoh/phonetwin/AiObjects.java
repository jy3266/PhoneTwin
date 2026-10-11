package studio.junoh.phonetwin;

import java.util.*;

/**
 * Objects recognised by the on-device detector, placed in the scan. Each camera detection is turned into a
 * 3D observation (label + point on the scan); observations of the same label close together are merged.
 * An object counts once it was seen CONFIRM times, which filters one-off misdetections. Pure Java, thread-safe.
 */
final class AiObjects {
    static final int CONFIRM = 3;

    static final class Item {
        final String label; float x, y, z, r; int hits;
        Item(String label, float x, float y, float z, float r, int hits) { this.label = label; this.x = x; this.y = y; this.z = z; this.r = r; this.hits = hits; }
        boolean confirmed() { return hits >= CONFIRM; }
    }

    private final List<Item> items = new ArrayList<>();

    /** Adds one observation (scan units). Returns true when this observation just confirmed an object. */
    synchronized boolean observe(String label, float x, float y, float z, float r, float mergeDist) {
        Item best = null; float bestD = Float.MAX_VALUE;
        for (Item it : items) {
            if (!it.label.equals(label)) continue;
            float d = (float)Math.hypot(it.x - x, it.z - z);
            if (d < Math.max(mergeDist, (it.r + r)*.6f) && d < bestD) { best = it; bestD = d; }
        }
        if (best == null) { items.add(new Item(label, x, y, z, r, 1)); return CONFIRM <= 1; }
        float w = Math.min(best.hits, 10);
        best.x = (best.x*w + x)/(w+1); best.y = (best.y*w + y)/(w+1); best.z = (best.z*w + z)/(w+1); best.r = (best.r*w + r)/(w+1);
        best.hits++;
        return best.hits == CONFIRM;
    }

    synchronized void add(Item it) { items.add(it); }
    synchronized List<Item> confirmed() { List<Item> out = new ArrayList<>(); for (Item it : items) if (it.confirmed()) out.add(copy(it)); return out; }
    synchronized void removeLabel(String label) { items.removeIf(it -> it.label.equals(label)); }
    synchronized void clear() { items.clear(); }
    private static Item copy(Item it) { return new Item(it.label, it.x, it.y, it.z, it.r, it.hits); }

    // ------------------------------------------------------------------ labels (COCO, as reported by EfficientDet)
    static final String[] LABELS = {"person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
        "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
        "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
        "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife",
        "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
        "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
        "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"};
    private static final String[] KOREAN = {"사람", "자전거", "자동차", "오토바이", "비행기", "버스", "기차", "트럭", "보트", "신호등",
        "소화전", "정지 표지판", "주차 미터기", "벤치", "새", "고양이", "개", "말", "양", "소", "코끼리", "곰", "얼룩말",
        "기린", "배낭", "우산", "핸드백", "넥타이", "여행가방", "원반", "스키", "스노보드", "공", "연",
        "야구 배트", "야구 글러브", "스케이트보드", "서핑보드", "테니스 라켓", "병", "와인잔", "컵", "포크", "나이프",
        "숟가락", "그릇", "바나나", "사과", "샌드위치", "오렌지", "브로콜리", "당근", "핫도그", "피자", "도넛", "케이크", "의자",
        "소파", "화분", "침대", "테이블", "변기", "TV·모니터", "노트북", "마우스", "리모컨", "키보드", "휴대폰",
        "전자레인지", "오븐", "토스터", "싱크대", "냉장고", "책", "시계", "꽃병", "가위", "곰인형", "헤어드라이어", "칫솔"};

    static String korean(String label) {
        for (int i = 0; i < LABELS.length; i++) if (LABELS[i].equals(label)) return KOREAN[i];
        return label;
    }
    /** File-name-safe key for a label ("dining table" -> "dining_table"). */
    static String fileKey(String label) { return label.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "_"); }
}
