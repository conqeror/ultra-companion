import type { DisplayClimb, DisplayPOI, RoutePoint, UnitSystem } from "@/types";
import type { ClimbProfileSegment } from "@/utils/climbProfile";
import type { CollectionSegmentProfileBoundary } from "@/utils/collectionSegmentDisplay";
import type { ElevationProfileFerrySpan } from "@/utils/elevationProfileFerries";

export interface ElevationProfileProps {
  points: RoutePoint[];
  units: UnitSystem;
  width: number;
  height: number;
  currentPointIndex?: number;
  currentDistanceMeters?: number;
  showLegend?: boolean;
  /** Offset added to X-axis labels so they show absolute route distance */
  distanceOffsetMeters?: number;
  /** Optional label-only X-axis offset. Defaults to distanceOffsetMeters. */
  xAxisLabelOffsetMeters?: number;
  /** Optional fixed X-axis tick interval, useful for climb-local kilometer markers. */
  xTickIntervalMeters?: number;
  /** Climb-style axes use right-side elevation labels and kilometer tick marks. */
  axisStyle?: "standard" | "climb";
  yAxisSide?: "left" | "right";
  /** Minimum horizontal chart density before scrolling is enabled. */
  minPixelsPerKm?: number;
  pois?: DisplayPOI[];
  onPOIPress?: (poi: DisplayPOI) => void;
  /** Vertical boundary lines at segment junctions (for stitched collections) */
  segmentBoundaries?: CollectionSegmentProfileBoundary[];
  climbs?: DisplayClimb[];
  /** Ferry intervals in the profile's absolute distance space. */
  ferries?: readonly ElevationProfileFerrySpan[];
  /** Force fit-to-width — disables horizontal scrolling and the overview minimap */
  fitToWidth?: boolean;
  /** Show the overview scrubber when the chart is horizontally scrollable. */
  showScrollOverview?: boolean;
  /** Fill the area under the profile with the same gradient used by the line */
  gradientAreaFill?: boolean;
  gradientAreaOpacity?: number;
  /** Optional climb-local gradient bands shown along the chart base. */
  gradientSegments?: ClimbProfileSegment[];
  /** Optional override for the profile stroke. Defaults to the elevation gradient. */
  lineStrokeColor?: string;
  lineStrokeWidth?: number;
}
