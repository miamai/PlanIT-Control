import { type LatLngBoundsExpression, type PointExpression } from 'leaflet'

// Geographic extent of the contiguous 48 states. Other states retain their markers.
export const CONTIGUOUS_US_BOUNDS: LatLngBoundsExpression = [
  [24.4, -125],
  [49.5, -66.5],
]
// Five percent at either coast leaves about 90% of the width for the US.
export function nationalMapPadding(width: number): PointExpression {
  return [width * 0.05, 16]
}
