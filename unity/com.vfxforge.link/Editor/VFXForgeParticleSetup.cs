using System.IO;
using UnityEditor;
using UnityEngine;

namespace VFXForge.Link
{
    /// <summary>Makes a Particle System play a sprite sheet exported by VFXForge.</summary>
    public class VFXForgeParticleSetup : EditorWindow
    {
        ParticleSystem system;
        Texture2D sheet;
        Material template;

        [MenuItem("Window/VFXForge/Particle Sheet Setup")]
        static void Open()
        {
            var window = GetWindow<VFXForgeParticleSetup>(true, "VFXForge Sheet Setup");
            window.minSize = new Vector2(360, 170);
            window.TakeSelection();
            window.Show();
        }

        /// <summary>One step: a new Particle System in the scene that plays the selected sheet.</summary>
        [MenuItem("Assets/VFXForge/Create Particle System")]
        static void CreateFromSelection()
        {
            foreach (var texture in Selection.GetFiltered<Texture2D>(SelectionMode.Assets))
            {
                var sidecar = VFXForgeSidecar.Load(AssetDatabase.GetAssetPath(texture));
                if (sidecar == null) continue;
                var go = new GameObject(texture.name, typeof(ParticleSystem));
                Undo.RegisterCreatedObjectUndo(go, "Create VFXForge Particle System");
                var created = go.GetComponent<ParticleSystem>();
                // A quiet starting point: one particle at a time, standing still, living for one pass of the sheet.
                float seconds = sidecar.IsSheet && sidecar.sheet.fps > 0 ? sidecar.FrameCount / sidecar.sheet.fps : 1f;
                var main = created.main;
                main.startLifetime = seconds;
                main.startSpeed = 0f;
                main.startSize = 2f;
                main.loop = true;
                var emission = created.emission;
                emission.rateOverTime = 1f / seconds;
                var shape = created.shape;
                shape.enabled = false;
                Apply(created, texture, sidecar, null);
                Selection.activeGameObject = go;
            }
        }

        [MenuItem("Assets/VFXForge/Create Particle System", true)]
        static bool CanCreate()
        {
            foreach (var texture in Selection.GetFiltered<Texture2D>(SelectionMode.Assets))
                if (VFXForgeSidecar.Load(AssetDatabase.GetAssetPath(texture)) != null) return true;
            return false;
        }

        void TakeSelection()
        {
            foreach (var go in Selection.gameObjects)
            {
                var found = go.GetComponent<ParticleSystem>();
                if (found != null && !EditorUtility.IsPersistent(go)) system = found;
            }
            foreach (var texture in Selection.GetFiltered<Texture2D>(SelectionMode.Assets))
                if (VFXForgeSidecar.Load(AssetDatabase.GetAssetPath(texture)) != null) sheet = texture;
        }

        void OnGUI()
        {
            EditorGUILayout.Space();
            system = (ParticleSystem)EditorGUILayout.ObjectField("Particle System", system, typeof(ParticleSystem), true);
            sheet = (Texture2D)EditorGUILayout.ObjectField("Sheet", sheet, typeof(Texture2D), false);
            template = (Material)EditorGUILayout.ObjectField(new GUIContent("Material (optional)", "A material on your own shader. A copy is made and the sheet is put in its main texture. Leave empty for a plain unlit particle material."), template, typeof(Material), false);

            VFXForgeSidecar sidecar = sheet != null ? VFXForgeSidecar.Load(AssetDatabase.GetAssetPath(sheet)) : null;
            if (sheet != null && sidecar == null)
                EditorGUILayout.HelpBox("This texture has no .vfxforge.json next to it. Export it from VFXForge into this project.", MessageType.Warning);
            else if (sidecar != null && sidecar.IsSheet)
                EditorGUILayout.HelpBox($"{sidecar.sheet.cols} x {sidecar.sheet.rows} tiles, {sidecar.FrameCount} frames at {sidecar.sheet.fps} fps, {(sidecar.Premultiplied ? "premultiplied" : "straight")} alpha.", MessageType.None);
            else if (sidecar != null)
                EditorGUILayout.HelpBox("A single image, not a sheet. It will be shown without animation.", MessageType.None);

            using (new EditorGUI.DisabledScope(system == null || sidecar == null))
            {
                if (GUILayout.Button("Apply")) Apply(system, sheet, sidecar, template);
            }
        }

        public static void Apply(ParticleSystem target, Texture2D texture, VFXForgeSidecar sidecar, Material templateMaterial)
        {
            Undo.RecordObject(target, "Apply VFXForge Sheet");
            var animation = target.textureSheetAnimation;
            if (sidecar.IsSheet)
            {
                int tiles = sidecar.sheet.cols * sidecar.sheet.rows;
                int frames = sidecar.FrameCount;
                animation.enabled = true;
                animation.mode = ParticleSystemAnimationMode.Grid;
                animation.numTilesX = sidecar.sheet.cols;
                animation.numTilesY = sidecar.sheet.rows;
                animation.animation = ParticleSystemAnimationType.WholeSheet;
                animation.startFrame = 0f;
                if (frames == tiles && sidecar.sheet.fps > 0)
                {
                    // Every tile is a frame: play at the sheet's own speed, whatever the particle's lifetime.
                    animation.timeMode = ParticleSystemAnimationTimeMode.FPS;
                    animation.fps = sidecar.sheet.fps;
                }
                else
                {
                    // Some tiles are empty: stop the frame curve at the last real frame and repeat it to match the speed.
                    animation.timeMode = ParticleSystemAnimationTimeMode.Lifetime;
                    animation.frameOverTime = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 0f, 1f, (float)frames / tiles));
                    float lifetime = Mathf.Max(0.01f, target.main.startLifetime.constantMax);
                    float cycles = sidecar.sheet.fps > 0 ? lifetime * sidecar.sheet.fps / frames : 1f;
                    animation.cycleCount = sidecar.sheet.loop ? Mathf.Max(1, Mathf.RoundToInt(cycles)) : 1;
                }
            }
            else
            {
                animation.enabled = false;
            }

            var renderer = target.GetComponent<ParticleSystemRenderer>();
            if (renderer != null)
            {
                Undo.RecordObject(renderer, "Apply VFXForge Sheet");
                renderer.sharedMaterial = MaterialFor(texture, sidecar, templateMaterial);
            }
            EditorUtility.SetDirty(target);
        }

        /// <summary>The material asset next to the texture, created on first use and updated after that.</summary>
        static Material MaterialFor(Texture2D texture, VFXForgeSidecar sidecar, Material templateMaterial)
        {
            string texturePath = AssetDatabase.GetAssetPath(texture);
            string folder = Path.GetDirectoryName(texturePath).Replace('\\', '/');
            string path = $"{folder}/{Path.GetFileNameWithoutExtension(texturePath)}_mat.mat";
            var material = AssetDatabase.LoadAssetAtPath<Material>(path);
            bool isNew = material == null;
            if (isNew) material = templateMaterial != null ? new Material(templateMaterial) : NewUnlit(sidecar.Premultiplied);
            else if (templateMaterial != null) { material.shader = templateMaterial.shader; material.CopyPropertiesFromMaterial(templateMaterial); }

            material.mainTexture = texture;
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", texture);
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", texture);

            if (isNew) AssetDatabase.CreateAsset(material, path);
            else EditorUtility.SetDirty(material);
            AssetDatabase.SaveAssets();
            return material;
        }

        static Material NewUnlit(bool premultiplied)
        {
            var urp = Shader.Find("Universal Render Pipeline/Particles/Unlit");
            if (urp != null)
            {
                var material = new Material(urp);
                material.SetFloat("_Surface", 1f); // Transparent
                material.SetFloat("_Blend", premultiplied ? 1f : 0f);
                material.SetFloat("_SrcBlend", (float)(premultiplied ? UnityEngine.Rendering.BlendMode.One : UnityEngine.Rendering.BlendMode.SrcAlpha));
                material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
                material.SetFloat("_ZWrite", 0f);
                material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                if (premultiplied) material.EnableKeyword("_ALPHAPREMULTIPLY_ON");
                material.SetOverrideTag("RenderType", "Transparent");
                material.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
                return material;
            }
            var legacy = Shader.Find(premultiplied ? "Legacy Shaders/Particles/Alpha Blended Premultiply" : "Legacy Shaders/Particles/Alpha Blended");
            if (legacy == null) legacy = Shader.Find("Sprites/Default");
            return new Material(legacy);
        }
    }
}
