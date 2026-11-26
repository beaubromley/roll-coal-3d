import { Vector3 } from "@babylonjs/core";

/** The rig (substructure, floor, mast, doghouse, cabin, V-door, pipe racks, catwalk) is built facing +z and then turned a quarter turn:
 *  local (x, z) -> world (-z, x), so the V-door and racks now point west (-x). Anything that talks about a rig-local spot goes through here. */
export const RYAW = -Math.PI / 2;
export const rv = (x: number, y: number, z: number) => new Vector3(-z, y, x);
export const rpos = (p: Vector3) => new Vector3(-p.z, p.y, p.x);
