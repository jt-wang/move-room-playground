import Foundation
import AVFoundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

@main struct ExtractSDR {
 static func main() async throws {
  guard CommandLine.arguments.count == 5 else { throw NSError(domain:"Usage: extract-sdr VIDEO NEW_OUTPUT COUNT LONG_EDGE",code:1) }
  guard #available(macOS 15, *) else { throw NSError(domain:"Native HDR extraction requires macOS 15+",code:1) }
  let a=CommandLine.arguments, input=URL(fileURLWithPath:a[1]), out=URL(fileURLWithPath:a[2],isDirectory:true)
  guard let count=Int(a[3]),count>0,count<=256,let edge=Int(a[4]),edge>=320,edge<=4096,!FileManager.default.fileExists(atPath:out.path) else { throw NSError(domain:"Invalid count/edge or output already exists",code:1) }
  let asset=AVURLAsset(url:input), duration=try await asset.load(.duration).seconds
  guard duration.isFinite && duration>0 else { throw NSError(domain:"Invalid duration",code:1) }
  let generator=AVAssetImageGenerator(asset:asset)
  generator.appliesPreferredTrackTransform=true
  generator.maximumSize=CGSize(width:edge,height:edge)
  generator.dynamicRangePolicy = .forceSDR
  generator.requestedTimeToleranceBefore = .zero
  generator.requestedTimeToleranceAfter = .zero
  try FileManager.default.createDirectory(at:out,withIntermediateDirectories:true)
  var frames=[[String:Any]]()
  for index in 0..<count {
   let requested=duration*(Double(index)+0.5)/Double(count)
   let result=try await generator.image(at:CMTime(seconds:requested,preferredTimescale:60000))
   let image=result.image
   guard image.contentHeadroom<=1.001 else { throw NSError(domain:"forceSDR returned HDR headroom",code:1) }
   // Color-managed conversion from the returned 709-transfer image (which can
   // retain BT.2020 primaries) to an actual sRGB bitmap, not a profile relabel.
   let srgb=CGColorSpace(name:CGColorSpace.sRGB)!
   guard let context=CGContext(data:nil,width:image.width,height:image.height,bitsPerComponent:8,bytesPerRow:0,space:srgb,bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue) else { throw NSError(domain:"sRGB context failed",code:1) }
   context.interpolationQuality = .high
   context.draw(image,in:CGRect(x:0,y:0,width:image.width,height:image.height))
   guard let converted=context.makeImage() else { throw NSError(domain:"sRGB conversion failed",code:1) }
   let filename=String(format:"frame_%03d.jpg",index+1), file=out.appendingPathComponent(filename)
   guard let dest=CGImageDestinationCreateWithURL(file as CFURL,UTType.jpeg.identifier as CFString,1,nil) else { throw NSError(domain:"JPEG destination failed",code:1) }
   CGImageDestinationAddImage(dest,converted,[kCGImageDestinationLossyCompressionQuality:0.95] as CFDictionary)
   guard CGImageDestinationFinalize(dest) else { throw NSError(domain:"JPEG encoding failed",code:1) }
   frames.append(["path":filename,"timestamp_seconds":requested,"actual_timestamp_seconds":result.actualTime.seconds,"width":image.width,"height":image.height,"generated_headroom":image.contentHeadroom,"generated_color_space":image.colorSpace?.name as String? ?? "unknown","output_color_space":"sRGB","output_bits":8])
   print("Extracted \(index+1)/\(count)")
  }
  let report:[String:Any] = ["engine":"Apple AVAssetImageGenerator","dynamic_range_policy":"forceSDR","color_conversion":"CGContext color-managed draw to sRGB","macos":ProcessInfo.processInfo.operatingSystemVersionString,"duration_seconds":duration,"frames":frames]
  try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:out.appendingPathComponent("extraction.json"))
 }
}
