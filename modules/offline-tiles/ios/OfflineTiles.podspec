Pod::Spec.new do |s|
  s.name           = 'OfflineTiles'
  s.version        = '1.0.0'
  s.summary        = 'Offline tile download using Mapbox LineString geometry'
  s.description    = 'Expo native module for efficient offline map tile downloads along a route corridor'
  s.license        = 'MIT'
  s.author         = 'Ultra Companion'
  s.homepage       = 'https://github.com/example'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'MapboxMaps', '~> 11.18'

  s.source_files = '**/*.swift'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
