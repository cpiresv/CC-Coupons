import Foundation
import Vision
import ImageIO
import UniformTypeIdentifiers

// The official app hides the authorization and timer from Android accessibility.
do {
    let args = CommandLine.arguments
    guard args.count == 9,
          let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw NSError(domain: "CardImage", code: 1) }
    let values = args[3...8].compactMap(Double.init)
    guard values.count == 6, values.allSatisfy({ $0.isFinite && $0 >= 0 }),
          values[4] > 0, values[5] > 0 else { throw NSError(domain: "CardBounds", code: 1) }
    let sx = Double(image.width) / values[4], sy = Double(image.height) / values[5]
    let rect = CGRect(x: values[0] * sx, y: values[1] * sy,
                      width: (values[2] - values[0]) * sx, height: (values[3] - values[1]) * sy).integral
    guard rect.width > 0, rect.height > 0,
          CGRect(x: 0, y: 0, width: image.width, height: image.height).contains(rect) else { throw NSError(domain: "CardBounds", code: 2) }
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    text.usesLanguageCorrection = false
    let barcode = VNDetectBarcodesRequest()
    try VNImageRequestHandler(cgImage: image).perform([text, barcode])
    func pixels(_ box: CGRect) -> CGRect {
        CGRect(x: box.minX * Double(image.width), y: (1 - box.maxY) * Double(image.height),
               width: box.width * Double(image.width), height: box.height * Double(image.height))
    }
    let barcodes = (barcode.results ?? []).filter { rect.contains(pixels($0.boundingBox)) && $0.payloadStringValue != nil }
    let timers = (text.results ?? []).compactMap { observation -> Int? in
        guard pixels(observation.boundingBox).minY > rect.maxY,
              let candidate = observation.topCandidates(1).first, candidate.confidence >= 0.9,
              candidate.string.range(of: "^[0-9]{2}:[0-5][0-9]$", options: .regularExpression) != nil else { return nil }
        let parts = candidate.string.split(separator: ":").compactMap { Int($0) }
        return parts[0] * 60 + parts[1]
    }
    guard barcodes.count == 1, timers.count == 1, (1...600).contains(timers[0]),
          let cropped = image.cropping(to: rect),
          let output = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { throw NSError(domain: "CardUnconfirmed", code: 1) }
    CGImageDestinationAddImage(output, cropped, nil)
    guard CGImageDestinationFinalize(output) else { throw NSError(domain: "CardImage", code: 2) }
    print("{\"remainingSeconds\":\(timers[0])}")
} catch {
    fputs("Card authorization could not be read.\n", stderr)
    exit(1)
}
