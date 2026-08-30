import AppKit
import Foundation

guard CommandLine.arguments.count == 5 else {
  fputs(
    "Usage: swift render-rounded-icon.swift <source.png> <destination.png> <size> <corner-ratio>\n",
    stderr
  )
  exit(2)
}

let sourcePath = CommandLine.arguments[1]
let destinationPath = CommandLine.arguments[2]
guard
  let size = Int(CommandLine.arguments[3]),
  size >= 16,
  let cornerRatio = Double(CommandLine.arguments[4]),
  cornerRatio > 0,
  cornerRatio < 0.5
else {
  fputs("Size or corner ratio is invalid\n", stderr)
  exit(2)
}

guard let source = NSImage(contentsOfFile: sourcePath) else {
  fputs("Could not read the source icon\n", stderr)
  exit(1)
}

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: size,
  pixelsHigh: size,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("Could not allocate the icon canvas\n", stderr)
  exit(1)
}

guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
  fputs("Could not create the icon graphics context\n", stderr)
  exit(1)
}

let bounds = NSRect(x: 0, y: 0, width: size, height: size)
let radius = CGFloat(size) * cornerRatio

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = size == Int(source.size.width) ? .none : .high
NSColor.clear.setFill()
bounds.fill()
NSBezierPath(roundedRect: bounds, xRadius: radius, yRadius: radius).addClip()
source.draw(
  in: bounds,
  from: NSRect(origin: .zero, size: source.size),
  operation: .copy,
  fraction: 1,
  respectFlipped: false,
  hints: nil
)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("Could not encode the rounded icon\n", stderr)
  exit(1)
}

try png.write(to: URL(fileURLWithPath: destinationPath), options: .atomic)
