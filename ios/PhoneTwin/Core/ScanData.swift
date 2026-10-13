import Foundation
import simd

/// Per-scan data kept beside the point cloud: scan A/B, placed objects, recognised (AI) objects.
/// Same JSON as the Android app's "scan_data" preference and compatible with the uploaded meta (PROTOCOL.md §2).
struct ScanData: Codable, Equatable {
    struct Placed: Codable, Equatable { var id: Int; var name: String; var c: [Float]; var r: Float }
    struct Ai: Codable, Equatable { var label: String; var c: [Float]; var r: Float; var hits: Int? }
    var a: [Float]?
    var b: [Float]?
    var objects: [Placed] = []
    var ai: [Ai] = []

    var scanA: SIMD3<Float>? { a.flatMap(ScanData.vec) }
    var scanB: SIMD3<Float>? { b.flatMap(ScanData.vec) }
    static func vec(_ v: [Float]) -> SIMD3<Float>? { v.count >= 3 ? SIMD3(v[0], v[1], v[2]) : nil }
    static func arr(_ v: SIMD3<Float>) -> [Float] { [v.x, v.y, v.z] }

    func json() -> String { (try? String(data: JSONEncoder().encode(self), encoding: .utf8) ?? "{}") ?? "{}" }
    static func parse(_ s: String) -> ScanData { (try? JSONDecoder().decode(ScanData.self, from: Data(s.utf8))) ?? ScanData() }
}

/// Objects recognised in the scan (labels as reported by the COCO detector of the Android app).
enum AiLabels {
    static let confirm = 3
    static let labels = ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
        "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
        "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
        "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife",
        "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
        "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
        "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"]
    private static let korean = ["사람", "자전거", "자동차", "오토바이", "비행기", "버스", "기차", "트럭", "보트", "신호등",
        "소화전", "정지 표지판", "주차 미터기", "벤치", "새", "고양이", "개", "말", "양", "소", "코끼리", "곰", "얼룩말",
        "기린", "배낭", "우산", "핸드백", "넥타이", "여행가방", "원반", "스키", "스노보드", "공", "연",
        "야구 배트", "야구 글러브", "스케이트보드", "서핑보드", "테니스 라켓", "병", "와인잔", "컵", "포크", "나이프",
        "숟가락", "그릇", "바나나", "사과", "샌드위치", "오렌지", "브로콜리", "당근", "핫도그", "피자", "도넛", "케이크", "의자",
        "소파", "화분", "침대", "테이블", "변기", "TV·모니터", "노트북", "마우스", "리모컨", "키보드", "휴대폰",
        "전자레인지", "오븐", "토스터", "싱크대", "냉장고", "책", "시계", "꽃병", "가위", "곰인형", "헤어드라이어", "칫솔"]

    static func korean(_ label: String) -> String {
        if let i = labels.firstIndex(of: label) { return korean[i] }
        return label
    }
    /// File-name-safe key for a label ("dining table" -> "dining_table").
    static func fileKey(_ label: String) -> String {
        var out = "", gap = false
        for ch in label.trimmingCharacters(in: .whitespaces).lowercased() {
            if ch.isASCII && (ch.isLetter || ch.isNumber) { if gap { out.append("_") }; out.append(ch); gap = false }
            else { gap = true }
        }
        if gap { out.append("_") }
        return out
    }
}

enum SoundMath {
    /// Left/right gain for an object at horizontal distance d (metres) seen at angle a from the heading
    /// (cosA, sinA; sinA > 0 = to the right). Silent beyond range, full at `near`.
    static func gains(d: Float, range: Float, near: Float, cosA: Float, sinA: Float) -> (Float, Float) {
        if !(d < range) { return (0, 0) }
        var g = max(0, min(1, (range - d)/max(1e-3, range - near)))
        g = g*g                                              // perceived loudness rises steadily as you approach
        g *= 0.3 + 0.7*(1 + cosA)/2                          // in front: full, behind: 30 %
        let pan = max(-1, min(1, sinA))*0.8, th = (pan + 1)*Float.pi/4
        return (min(1, g*cos(th)*1.4142), min(1, g*sin(th)*1.4142))
    }
}
