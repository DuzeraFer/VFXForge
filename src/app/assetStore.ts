import { registry } from "../nodes"
import { AssetLoader } from "./assets"

/** The one loader of the window. Outside Electron there are no files to read. */
export const assets = new AssetLoader(registry, (path, ref) => window.vfxforge?.readAsset(path, ref) ?? Promise.resolve(null))
