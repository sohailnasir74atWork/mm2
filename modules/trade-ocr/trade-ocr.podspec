require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "trade-ocr"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://mm2tradehub.com"
  s.license      = "UNLICENSED"
  s.author       = "MM2 Values"
  s.platform     = :ios, "15.1"
  s.source       = { :path => "." }
  s.source_files = "ios/*.{h,m}"
  s.frameworks   = "Vision"
  s.dependency "React-Core"
end
