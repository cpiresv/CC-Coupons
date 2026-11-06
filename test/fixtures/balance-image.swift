import AppKit

// Synthetic balance alongside a larger lifetime-savings amount.
let image = NSImage(size: NSSize(width: 600, height: 1000))
image.lockFocus()
NSColor.white.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: 600, height: 1000)).fill()
let small: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 24), .foregroundColor: NSColor.black]
let large: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 32), .foregroundColor: NSColor.black]
("Já ganhou 987,65 €" as NSString).draw(at: NSPoint(x: 30, y: 740), withAttributes: small)
(CommandLine.arguments[2] as NSString).draw(at: NSPoint(x: 360, y: 780), withAttributes: large)
("Carregar saldo" as NSString).draw(at: NSPoint(x: 350, y: 720), withAttributes: small)
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
