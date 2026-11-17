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

        public string tool;
        public int version;
        public string texture;
        public int width;
        public int height;
        public Sheet sheet;
        public string alpha;
        public string usage;

        /// <summary>True when the texture is a sprite sheet. JsonUtility turns "sheet": null into an empty object.</summary>
        public bool IsSheet => sheet != null && sheet.cols > 0 && sheet.rows > 0;

        public bool Premultiplied => alpha == "premultiplied";

        /// <summary>Only color textures are stored in sRGB. Masks, erosion, flow and normal maps hold numbers.</summary>
        public bool IsColor => string.IsNullOrEmpty(usage) || usage == "color";

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
