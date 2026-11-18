/**
 * Minimal decoder for Mapbox Vector Tiles (protobuf), enough to read layers, feature
 * attributes and geometries. Written out here so the map pipeline has no dependencies.
 */

export type MvtValue = string | number | boolean;

export interface MvtFeature {
  /** 1 point, 2 line string, 3 polygon. */
  type: number;
  properties: Record<string, MvtValue>;
  /** Paths in tile units (0..extent, may slightly exceed it in the buffer). */
  geometry: number[][];
}

export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtFeature[];
}

class Reader {
  pos = 0;

  constructor(
    readonly buf: Uint8Array,
    readonly end: number = buf.length,
  ) {}

  varint(): number {
    let result = 0;
    let shift = 1;
    for (;;) {
      const byte = this.buf[this.pos++] as number;
      result += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return result;
      shift *= 128;
    }
  }

  skip(wireType: number): void {
    if (wireType === 0) this.varint();
    else if (wireType === 1) this.pos += 8;
    else if (wireType === 2) this.pos += this.varint();
    else if (wireType === 5) this.pos += 4;
    else throw new Error(`Unsupported protobuf wire type ${wireType}`);
  }

  /** Reads a length prefix and returns a reader limited to that message. */
  sub(): Reader {
    const length = this.varint();
    const reader = new Reader(this.buf, this.pos + length);
    reader.pos = this.pos;
    this.pos += length;
    return reader;
  }

  string(): string {
    const length = this.varint();
    const text = Buffer.from(this.buf.buffer, this.buf.byteOffset + this.pos, length).toString('utf8');
    this.pos += length;
    return text;
  }
}

const zigzag = (n: number): number => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function readValue(r: Reader): MvtValue {
  let value: MvtValue = '';
  const view = new DataView(r.buf.buffer, r.buf.byteOffset);
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1) value = r.string();
    else if (field === 2) {
      value = view.getFloat32(r.pos, true);
      r.pos += 4;
    } else if (field === 3) {
      value = view.getFloat64(r.pos, true);
      r.pos += 8;
    } else if (field === 4 || field === 5) value = r.varint();
    else if (field === 6) value = zigzag(r.varint());
    else if (field === 7) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
}

function readGeometry(r: Reader): number[][] {
  const paths: number[][] = [];
  let current: number[] | null = null;
  let x = 0;
  let y = 0;
  while (r.pos < r.end) {
    const command = r.varint();
    const id = command & 7;
    const count = command >> 3;
    if (id === 1 || id === 2) {
      for (let i = 0; i < count; i++) {
        x += zigzag(r.varint());
        y += zigzag(r.varint());
        if (id === 1) {
          current = [x, y];
          paths.push(current);
        } else if (current) {
          current.push(x, y);
        }
      }
    } else if (id === 7) {
      // ClosePath: repeat the first vertex so rings are explicit.
      if (current && current.length >= 2) current.push(current[0] as number, current[1] as number);
    } else {
      throw new Error(`Unknown geometry command ${id}`);
    }
  }
  return paths;
}

export function decodeTile(bytes: Uint8Array): Map<string, MvtLayer> {
  const layers = new Map<string, MvtLayer>();
  const tile = new Reader(bytes);
  while (tile.pos < tile.end) {
    const tag = tile.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) {
      tile.skip(tag & 7);
      continue;
    }
    const l = tile.sub();
    let name = '';
    let extent = 4096;
    const keys: string[] = [];
    const values: MvtValue[] = [];
    const rawFeatures: Reader[] = [];
    while (l.pos < l.end) {
      const t = l.varint();
      const field = t >> 3;
      if (field === 1) name = l.string();
      else if (field === 2) rawFeatures.push(l.sub());
      else if (field === 3) keys.push(l.string());
      else if (field === 4) values.push(readValue(l.sub()));
      else if (field === 5) extent = l.varint();
      else l.skip(t & 7);
    }
    const features: MvtFeature[] = [];
    for (const f of rawFeatures) {
      let type = 0;
      let tags: number[] = [];
      let geometry: number[][] = [];
      while (f.pos < f.end) {
        const t = f.varint();
        const field = t >> 3;
        if (field === 2) {
          const packed = f.sub();
          tags = [];
          while (packed.pos < packed.end) tags.push(packed.varint());
        } else if (field === 3) type = f.varint();
        else if (field === 4) geometry = readGeometry(f.sub());
        else f.skip(t & 7);
      }
      const properties: Record<string, MvtValue> = {};
      for (let i = 0; i + 1 < tags.length; i += 2) {
        const key = keys[tags[i] as number];
        const value = values[tags[i + 1] as number];
        if (key !== undefined && value !== undefined) properties[key] = value;
      }
      features.push({ type, properties, geometry });
    }
    layers.set(name, { name, extent, features });
  }
  return layers;
}
