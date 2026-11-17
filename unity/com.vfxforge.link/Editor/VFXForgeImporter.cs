using System;
using UnityEditor;
using UnityEngine;

namespace VFXForge.Link
{
    /// <summary>
    /// Applies import settings to textures that have a .vfxforge.json sidecar.
    /// Settings are applied once, the first time the pair is seen, so changes made in Unity afterwards are kept.
    /// Assets > VFXForge > Reapply Import Settings applies them again.
    /// </summary>
    public class VFXForgeImporter : AssetPostprocessor
    {
        const string Marker = "vfxforge-link";

        void OnPreprocessTexture()
        {
            var importer = (TextureImporter)assetImporter;
            if (!importer.importSettingsMissing && HasMarker(importer)) return;
            if (!importer.importSettingsMissing) return; // The sidecar arriving later is handled below.
            var sidecar = VFXForgeSidecar.Load(assetPath);
            if (sidecar == null) return;
            Apply(importer, sidecar);
        }

        static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
        {
            foreach (string path in imported)
            {
                if (!path.EndsWith(VFXForgeSidecar.Extension, StringComparison.OrdinalIgnoreCase)) continue;
                string texturePath = path.Substring(0, path.Length - VFXForgeSidecar.Extension.Length);
                var importer = AssetImporter.GetAtPath(texturePath) as TextureImporter;
                if (importer == null || HasMarker(importer)) continue;
                var sidecar = VFXForgeSidecar.Load(texturePath);
                if (sidecar == null) continue;
                Apply(importer, sidecar);
                importer.SaveAndReimport();
            }
        }

        static bool HasMarker(AssetImporter importer) => !string.IsNullOrEmpty(importer.userData) && importer.userData.Contains(Marker);

        public static void Apply(TextureImporter importer, VFXForgeSidecar sidecar)
        {
            bool normal = sidecar.usage == "normal";
            importer.textureType = normal ? TextureImporterType.NormalMap : TextureImporterType.Default;
            importer.textureShape = TextureImporterShape.Texture2D;
            if (!normal) importer.sRGBTexture = sidecar.IsColor;
            importer.alphaSource = TextureImporterAlphaSource.FromInput;
            // "Alpha is transparency" bleeds colors for straight alpha. Premultiplied pixels must stay as they are.
            importer.alphaIsTransparency = sidecar.IsColor && !sidecar.Premultiplied;
            importer.mipmapEnabled = true;
            importer.npotScale = TextureImporterNPOTScale.None;
            // A sheet must not wrap, or the last column shows up at the edge of the first.
            if (sidecar.IsSheet) importer.wrapMode = TextureWrapMode.Clamp;
            int longest = Mathf.Max(sidecar.width, sidecar.height);
            if (longest > 0) importer.maxTextureSize = Mathf.Clamp(Mathf.NextPowerOfTwo(longest), 32, 8192);
            importer.textureCompression = sidecar.IsColor ? TextureImporterCompression.CompressedHQ : TextureImporterCompression.Compressed;
            if (!HasMarker(importer)) importer.userData = string.IsNullOrEmpty(importer.userData) ? Marker : importer.userData + ";" + Marker;
        }

        [MenuItem("Assets/VFXForge/Reapply Import Settings")]
        static void Reapply()
        {
            foreach (var texture in Selection.GetFiltered<Texture2D>(SelectionMode.Assets))
            {
                string path = AssetDatabase.GetAssetPath(texture);
                var sidecar = VFXForgeSidecar.Load(path);
                var importer = AssetImporter.GetAtPath(path) as TextureImporter;
                if (sidecar == null || importer == null) continue;
                Apply(importer, sidecar);
                importer.SaveAndReimport();
            }
        }

        [MenuItem("Assets/VFXForge/Reapply Import Settings", true)]
        static bool CanReapply()
        {
            foreach (var texture in Selection.GetFiltered<Texture2D>(SelectionMode.Assets))
                if (VFXForgeSidecar.Load(AssetDatabase.GetAssetPath(texture)) != null) return true;
            return false;
        }
    }
}
