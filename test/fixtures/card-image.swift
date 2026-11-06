import AppKit
import CoreImage

// Synthetic authorization: no account or payment data.
let image = NSImage(size: NSSize(width: 600, height: 1000))
image.lockFocus()
NSColor.white.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: 600, height: 1000)).fill()
let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 48), .foregroundColor: NSColor.black]
("123456" as NSString).draw(at: NSPoint(x: 200, y: 650), withAttributes: attributes)
(CommandLine.arguments[2] as NSString).draw(at: NSPoint(x: 210, y: 120), withAttributes: attributes)
("15:30" as NSString).draw(at: NSPoint(x: 20, y: 930), withAttributes: attributes)
let filter = CIFilter(name: "CICode128BarcodeGenerator")!
filter.setValue(Data("123456789012".utf8), forKey: "inputMessage")
let barcode = filter.outputImage!
let cg = CIContext().createCGImage(barcode, from: barcode.extent)!
NSGraphicsContext.current!.imageInterpolation = .none
NSImage(cgImage: cg, size: .zero).draw(in: NSRect(x: 100, y: 450, width: 400, height: 140))
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
