/**
 * Fit a street map into a plain SVG viewport. The input is the street view's
 * map and nothing else.
 */

export interface StreetLayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly name?: string;
}

export interface StreetLayoutEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly street: string;
  readonly known: 'driven' | 'seen' | 'map' | 'local' | 'aid';
  readonly shape: readonly [number, number][];
  readonly oneWay: boolean;
  readonly traffic?: 'light' | 'moderate' | 'heavy';
}

export interface StreetLayoutMap {
  readonly nodes: readonly StreetLayoutNode[];
  readonly edges: readonly StreetLayoutEdge[];
  readonly locations: readonly { readonly name: string; readonly at: readonly [number, number] }[];
  readonly checkpoints: readonly { readonly name: string; readonly at: readonly [number, number] }[];
  readonly position?: { readonly at: readonly [number, number]; readonly headingDeg: number };
}

export interface Placed {
  readonly x: number;
  readonly y: number;
}

export interface StreetLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly (StreetLayoutNode & Placed)[];
  readonly edges: readonly { readonly id: string; readonly street: string; readonly known: StreetLayoutEdge['known']; readonly oneWay: boolean; readonly traffic?: StreetLayoutEdge['traffic']; readonly points: readonly Placed[] }[];
  readonly locations: readonly { readonly name: string; readonly x: number; readonly y: number }[];
  readonly checkpoints: readonly { readonly name: string; readonly x: number; readonly y: number }[];
  readonly position?: { readonly x: number; readonly y: number; readonly headingDeg: number };
}

const PAD = 24;

function fit(view: StreetLayoutMap, width: number, height: number): (at: readonly [number, number]) => Placed {
  const points = [
    ...view.nodes.map((node) => [node.x, node.y] as const),
    ...view.edges.flatMap((edge) => edge.shape),
  ];
  if (points.length === 0) return () => ({ x: width / 2, y: height / 2 });
  let minX = points[0]?.[0] ?? 0;
  let maxX = minX;
  let minY = points[0]?.[1] ?? 0;
  let maxY = minY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - PAD * 2) / spanX, (height - PAD * 2) / spanY);
  return (at) => ({
    x: PAD + (at[0] - minX) * scale,
    y: height - PAD - (at[1] - minY) * scale,
  });
}

/** North is up. Driven, seen and map edges keep the source the view already marked. */
export function layoutStreetMap(view: StreetLayoutMap, size: { readonly width: number; readonly height: number }): StreetLayout {
  const place = fit(view, size.width, size.height);
  return {
    width: size.width,
    height: size.height,
    nodes: view.nodes.map((node) => ({ ...node, ...place([node.x, node.y]) })),
    edges: view.edges.map((edge) => ({
      id: edge.id,
      street: edge.street,
      known: edge.known,
      oneWay: edge.oneWay,
      ...(edge.traffic === undefined ? {} : { traffic: edge.traffic }),
      points: edge.shape.map((at) => place(at)),
    })),
    locations: view.locations.map((placeAt) => ({ name: placeAt.name, ...place(placeAt.at) })),
    checkpoints: view.checkpoints.map((placeAt) => ({ name: placeAt.name, ...place(placeAt.at) })),
    ...(view.position === undefined
      ? {}
      : { position: { ...place(view.position.at), headingDeg: view.position.headingDeg } }),
  };
}
