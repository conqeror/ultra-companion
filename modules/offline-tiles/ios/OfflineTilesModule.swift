import ExpoModulesCore
import MapboxMaps

public class OfflineTilesModule: Module {
  private lazy var tileStore: TileStore = .default
  private lazy var offlineManager: OfflineManager = .init()
  private var activeTasks: [String: Cancelable] = [:]

  public func definition() -> ModuleDefinition {
    Name("OfflineTiles")

    Events("onProgress")

    AsyncFunction("downloadTileRegion") { (id: String, styleURL: String, coords: [[Double]], minZoom: Int, maxZoom: Int) async throws in
      guard let styleURI = StyleURI(rawValue: styleURL) else {
        throw Exception(name: "INVALID_STYLE", description: "Invalid style URL")
      }
      guard coords.count >= 2 else {
        throw Exception(name: "INVALID_COORDS", description: "Need at least 2 coordinates")
      }

      let coordinates = coords.map {
        CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0])
      }
      let geometry = Geometry.lineString(LineString(coordinates))

      let descriptorOptions = TilesetDescriptorOptions(
        styleURI: styleURI,
        zoomRange: UInt8(minZoom)...UInt8(maxZoom),
        tilesets: nil
      )
      let descriptor = self.offlineManager.createTilesetDescriptor(for: descriptorOptions)

      let loadOptions = TileRegionLoadOptions(
        geometry: geometry,
        descriptors: [descriptor],
        acceptExpired: true,
        networkRestriction: .none
      )!

      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        let task = self.tileStore.loadTileRegion(forId: id, loadOptions: loadOptions, progress: { progress in
          let pct = progress.requiredResourceCount > 0
            ? Double(progress.completedResourceCount) / Double(progress.requiredResourceCount) * 100.0
            : 0.0
          self.sendEvent("onProgress", [
            "id": id,
            "percentage": pct,
            "completedBytes": progress.completedResourceSize,
          ])
        }) { result in
          self.activeTasks.removeValue(forKey: id)
          switch result {
          case .success:
            continuation.resume()
          case .failure(let error):
            continuation.resume(throwing: error)
          }
        }
        self.activeTasks[id] = task
      }
    }

    AsyncFunction("cancelTileRegion") { (id: String) in
      self.activeTasks[id]?.cancel()
      self.activeTasks.removeValue(forKey: id)
    }

    AsyncFunction("deleteTileRegion") { (id: String) async throws in
      self.activeTasks[id]?.cancel()
      self.activeTasks.removeValue(forKey: id)
      self.tileStore.removeTileRegion(forId: id)
    }

    AsyncFunction("getTileRegionSize") { (id: String) async throws -> Int in
      return await withCheckedContinuation { continuation in
        self.tileStore.tileRegion(forId: id) { result in
          switch result {
          case .success(let region):
            continuation.resume(returning: Int(region.completedResourceSize))
          case .failure:
            continuation.resume(returning: 0)
          }
        }
      }
    }

    AsyncFunction("getAllTileRegions") { () async throws -> [[String: Any]] in
      return await withCheckedContinuation { continuation in
        self.tileStore.allTileRegions { result in
          switch result {
          case .success(let regions):
            let items = regions.map { region -> [String: Any] in
              return [
                "id": region.id,
                "completedBytes": region.completedResourceSize,
              ]
            }
            continuation.resume(returning: items)
          case .failure:
            continuation.resume(returning: [])
          }
        }
      }
    }
  }
}
