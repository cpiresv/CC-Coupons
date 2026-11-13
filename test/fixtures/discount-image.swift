import AppKit

let image = NSImage(size: NSSize(width: 600, height: 1000))
image.lockFocus()
NSColor.white.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: 600, height: 1000)).fill()
let large: [NSAttributedString.Key: Any] = [.font: NSFont.boldSystemFont(ofSize: 48), .foregroundColor: NSColor.black]
("99%" as NSString).draw(at: NSPoint(x: 30, y: 800), withAttributes: large)
(CommandLine.arguments[2] as NSString).draw(at: NSPoint(x: 230, y: 580), withAttributes: large)
if CommandLine.arguments.count > 3 {
    (CommandLine.arguments[3] as NSString).draw(at: NSPoint(x: 230, y: 480), withAttributes: large)
}
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
