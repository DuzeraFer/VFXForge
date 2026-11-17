using System;
using System.IO;
using UnityEngine;

namespace VFXForge.Link
{
    /// <summary>The .vfxforge.json file VFXForge writes next to every exported texture.</summary>
    [Serializable]
    public class VFXForgeSidecar
    {
        public const string Extension = ".vfxforge.json";

        [Serializable]
        public class Sheet
        {
            public int cols;
            public int rows;
            public int frames;
            public float fps;
            public bool loop;
            public int padding;
        }

        [Serializable]
        public class Packing
        {
            public string r;
            public string g;
            public string b;
            public string a;
        }

        public string tool;
        public int version;
        public string texture;
        public int width;
        public int height;
        public Sheet sheet;
        public string alpha;
        public string usage;
        public Packing packing;

        /// <summary>True when the texture is a sprite sheet. JsonUtility turns "sheet": null into an empty object.</summary>
        public bool IsSheet => sheet != null && sheet.cols > 0 && sheet.rows > 0;

        public bool Premultiplied => alpha == "premultiplied";

        /// <summary>Only color textures are stored in sRGB. Masks, erosion, flow and normal maps hold numbers.</summary>
        /// <summary>True when each channel holds its own grayscale image.</summary>
        public bool IsPacked => packing != null && !(string.IsNullOrEmpty(packing.r) && string.IsNullOrEmpty(packing.g) && string.IsNullOrEmpty(packing.b) && string.IsNullOrEmpty(packing.a));

        public bool IsColor => !IsPacked && (string.IsNullOrEmpty(usage) || usage == "color");

        public int FrameCount => IsSheet ? Mathf.Clamp(sheet.frames > 0 ? sheet.frames : sheet.cols * sheet.rows, 1, sheet.cols * sheet.rows) : 1;

        public static string PathFor(string texturePath) => texturePath + Extension;

        /// <summary>Reads the sidecar of a texture asset. Returns null when there is none or it is not ours.</summary>
        public static VFXForgeSidecar Load(string texturePath)
        {
            string path = PathFor(texturePath);
            if (!File.Exists(path)) return null;
            try
            {
                var sidecar = JsonUtility.FromJson<VFXForgeSidecar>(File.ReadAllText(path));
                return sidecar != null && sidecar.tool == "VFXForge" ? sidecar : null;
            }
            catch (Exception error)
            {
                Debug.LogWarning($"VFXForge: could not read {path}: {error.Message}");
                return null;
            }
        }
    }
}
