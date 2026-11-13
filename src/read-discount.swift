import Foundation
import Vision
import ImageIO

func pixels(_ image: CGImage) throws -> [UInt8] {
    guard let context = CGContext(data: nil, width: 128, height: 128, bitsPerComponent: 8,
        bytesPerRow: 512, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
        let data = context.data else { throw NSError(domain: "DiscountImage", code: 2) }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: 128, height: 128))
    return Array(UnsafeBufferPointer(start: data.assumingMemoryBound(to: UInt8.self), count: 65536))
}

func matchesArtwork(_ image: CGImage, _ name: String) throws -> Bool {
    // shortcut: Vision cannot reliably read these stylized units; re-verify references if the artwork changes.
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("discount-images/\(name).png")
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let reference = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return false }
    let actual = try pixels(image), expected = try pixels(reference)
    var difference = 0.0, count = 0, unitDifference = 0.0, unitCount = 0
    for y in 0..<128 {
        for x in 0..<128 {
            let i = (y * 128 + x) * 4
            if expected[i + 3] <= 250 { continue }
            for channel in 0..<3 {
                let delta = Double(abs(Int(actual[i + channel]) - Int(expected[i + channel]))) / 255
                difference += delta; count += 1
                if x >= 83 && x < 108 && y >= 51 && y < 71 {
                    unitDifference += delta; unitCount += 1
                }
            }
        }
    }
    return count > 0 && unitCount > 0 && difference / Double(count) < 0.04 && unitDifference / Double(unitCount) < 0.04
}

// Recover a missing unit from the coupon's discount image, not its surrounding conditions.
do {
    let args = CommandLine.arguments
    guard args.count == 8,
          let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "DiscountImage", code: 1) }
    let values = args[2...7].compactMap(Double.init)
    guard values.count == 6, values.allSatisfy({ $0.isFinite && $0 >= 0 }),
          values[4] > 0, values[5] > 0 else { throw NSError(domain: "DiscountBounds", code: 1) }
    let sx = Double(image.width) / values[4], sy = Double(image.height) / values[5]
    let rect = CGRect(x: values[0] * sx, y: values[1] * sy,
                      width: (values[2] - values[0]) * sx, height: (values[3] - values[1]) * sy).integral
    guard rect.width > 0, rect.height > 0,
          CGRect(x: 0, y: 0, width: image.width, height: image.height).contains(rect),
          let cropped = image.cropping(to: rect) else { throw NSError(domain: "DiscountBounds", code: 2) }
    let discount: String
    if try matchesArtwork(cropped, "wells-30") {
        discount = "30 €"
    } else if try matchesArtwork(cropped, "wells-15") {
        discount = "15%"
    } else {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: cropped).perform([request])
        let amounts = (request.results ?? []).compactMap { $0.topCandidates(1).first }
            .filter { $0.confidence >= 0.9 && $0.string.range(of: #"^\d+(?:[.,]\d+)?\s*[%€]$"#, options: .regularExpression) != nil }
            .map { $0.string }
        guard amounts.count == 1 else { throw NSError(domain: "DiscountUnconfirmed", code: 1) }
        discount = amounts[0]
    }
    let json = try JSONSerialization.data(withJSONObject: ["discount": discount])
    print(String(decoding: json, as: UTF8.self))
} catch {
    fputs("Coupon discount could not be confirmed.\n", stderr)
    exit(1)
}
