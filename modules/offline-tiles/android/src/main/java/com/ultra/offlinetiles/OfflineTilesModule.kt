package com.ultra.offlinetiles

import com.mapbox.common.Cancelable
import com.mapbox.common.MapboxOptions
import com.mapbox.common.NetworkRestriction
import com.mapbox.common.TileRegionError
import com.mapbox.common.TileStore
import com.mapbox.geojson.LineString
import com.mapbox.geojson.Point
import com.mapbox.maps.GlyphsRasterizationMode
import com.mapbox.maps.OfflineManager
import com.mapbox.maps.StylePackLoadOptions
import com.mapbox.maps.TilesetDescriptorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap

private class InvalidStyleException :
  CodedException("Invalid style URL")

private class InvalidCoordinatesException :
  CodedException("Need at least 2 coordinates")

private class InvalidZoomRangeException :
  CodedException("Invalid zoom range")

private class TileRegionException(error: TileRegionError?) :
  CodedException(error?.message ?: "Tile region operation failed")

class OfflineTilesModule : Module() {
  private val tileStore: TileStore by lazy { TileStore.create() }
  private val offlineManager: OfflineManager by lazy { OfflineManager() }
  private val activeTasks = ConcurrentHashMap<String, Cancelable>()

  override fun definition() = ModuleDefinition {
    Name("OfflineTiles")

    Events("onProgress")

    Function("setAccessToken") { accessToken: String ->
      if (accessToken.isNotBlank()) {
        MapboxOptions.accessToken = accessToken
      }
    }

    AsyncFunction("downloadTileRegion") {
      id: String,
      styleURL: String,
      coords: List<List<Double>>,
      minZoom: Int,
      maxZoom: Int,
      promise: Promise,
      ->
      try {
        validateDownloadOptions(styleURL, coords, minZoom, maxZoom)

        val points = coords.map { coord ->
          Point.fromLngLat(coord[0], coord[1])
        }
        val geometry = LineString.fromLngLats(points)

        val stylePackOptions = StylePackLoadOptions.Builder()
          .glyphsRasterizationMode(GlyphsRasterizationMode.IDEOGRAPHS_RASTERIZED_LOCALLY)
          .build()
        val descriptorOptions = TilesetDescriptorOptions.Builder()
          .styleURI(styleURL)
          .minZoom(minZoom.toByte())
          .maxZoom(maxZoom.toByte())
          .stylePackOptions(stylePackOptions)
          .pixelRatio(2.0f)
          .build()
        val descriptor = offlineManager.createTilesetDescriptor(descriptorOptions)
        val loadOptions = com.mapbox.common.TileRegionLoadOptions.Builder()
          .geometry(geometry)
          .descriptors(listOf(descriptor))
          .acceptExpired(true)
          .networkRestriction(NetworkRestriction.NONE)
          .build()

        activeTasks[id]?.cancel()
        val task = tileStore.loadTileRegion(
          id,
          loadOptions,
          { progress ->
            val percentage = if (progress.requiredResourceCount > 0) {
              progress.completedResourceCount.toDouble() / progress.requiredResourceCount.toDouble() * 100.0
            } else {
              0.0
            }
            sendEvent(
              "onProgress",
              mapOf(
                "id" to id,
                "percentage" to percentage,
                "completedBytes" to progress.completedResourceSize.toDouble(),
              ),
            )
          },
          { expected ->
            activeTasks.remove(id)
            if (expected.isValue) {
              promise.resolve()
            } else {
              promise.reject(TileRegionException(expected.error))
            }
          },
        )
        activeTasks[id] = task
      } catch (error: CodedException) {
        activeTasks.remove(id)
        promise.reject(error)
      } catch (error: Throwable) {
        activeTasks.remove(id)
        promise.reject("ERR_OFFLINE_TILES", error.message, error)
      }
    }

    AsyncFunction("cancelTileRegion") { id: String ->
      activeTasks.remove(id)?.cancel()
    }

    AsyncFunction("deleteTileRegion") { id: String, promise: Promise ->
      activeTasks.remove(id)?.cancel()
      tileStore.removeTileRegion(id) { expected ->
        if (expected.isValue) {
          promise.resolve()
        } else {
          promise.reject(TileRegionException(expected.error))
        }
      }
    }

    AsyncFunction("getTileRegionSize") { id: String, promise: Promise ->
      tileStore.getTileRegion(id) { expected ->
        val region = expected.value
        if (region == null) {
          promise.resolve(0.0)
        } else {
          promise.resolve(region.completedResourceSize.toDouble())
        }
      }
    }

    AsyncFunction("getAllTileRegions") { promise: Promise ->
      tileStore.getAllTileRegions { expected ->
        val regions = expected.value
        if (regions == null) {
          promise.resolve(emptyList<Map<String, Any?>>())
        } else {
          promise.resolve(
            regions.map { region ->
              mapOf(
                "id" to region.id,
                "completedBytes" to region.completedResourceSize.toDouble(),
              )
            },
          )
        }
      }
    }
  }

  private fun validateDownloadOptions(
    styleURL: String,
    coords: List<List<Double>>,
    minZoom: Int,
    maxZoom: Int,
  ) {
    if (styleURL.isBlank()) {
      throw InvalidStyleException()
    }
    if (coords.size < 2 || coords.any { it.size < 2 }) {
      throw InvalidCoordinatesException()
    }
    if (minZoom < 0 || maxZoom < minZoom || maxZoom > 22) {
      throw InvalidZoomRangeException()
    }
  }
}
