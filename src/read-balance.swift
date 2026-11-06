import Foundation
import Vision
import ImageIO

// Read only the home screen's balance region, excluding lifetime savings and offers.
do {
    let args = CommandLine.arguments
    guard args.count == 8,
          let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "BalanceImage", code: 1) }
    let values = args[2...7].compactMap(Double.init)
    guard values.count == 6, values.allSatisfy({ $0.isFinite && $0 >= 0 }),
          values[4] > 0, values[5] > 0 else { throw NSError(domain: "BalanceBounds", code: 1) }
    let sx = Double(image.width) / values[4], sy = Double(image.height) / values[5]
    let rect = CGRect(x: values[0] * sx, y: values[1] * sy,
                      width: (values[2] - values[0]) * sx, height: (values[3] - values[1]) * sy).integral
    guard rect.width > 0, rect.height > 0,
          CGRect(x: 0, y: 0, width: image.width, height: image.height).contains(rect) else { throw NSError(domain: "BalanceBounds", code: 2) }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    // Full-screen context keeps zero amounts upright; accept text only inside the balance region.
    try VNImageRequestHandler(cgImage: image).perform([request])
    let amounts = (request.results ?? []).filter {
        let box = $0.boundingBox
        let pixels = CGRect(x: box.minX * Double(image.width), y: (1 - box.maxY) * Double(image.height),
                            width: box.width * Double(image.width), height: box.height * Double(image.height))
        let overlap = rect.intersection(pixels)
        // OCR adds a few pixels beyond the app's reported text bounds.
        return !overlap.isNull && overlap.width * overlap.height >= pixels.width * pixels.height * 0.95
    }.compactMap { $0.topCandidates(1).first }
        .filter { $0.confidence >= 0.9 && $0.string.contains("€") }
        .map { $0.string }
    guard amounts.count == 1 else { throw NSError(domain: "BalanceUnconfirmed", code: 1) }
    let json = try JSONSerialization.data(withJSONObject: ["amount": amounts[0]])
    print(String(decoding: json, as: UTF8.self))
} catch {
    fputs("Card balance could not be read.\n", stderr)
    exit(1)
}
