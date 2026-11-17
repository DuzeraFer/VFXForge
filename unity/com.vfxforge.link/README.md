# VFXForge Link for Unity

An editor-only package. It reads the `.vfxforge.json` file that VFXForge writes next to every exported texture.

## Install

In Unity: Window › Package Manager › **+** › *Add package from git URL*:

```
https://github.com/DuzeraFer/VFXForge.git?path=/unity/com.vfxforge.link
```

Or *Add package from disk* and pick this folder's `package.json`. Needs Unity 2021.3 or newer.

## Use

1. In VFXForge, press **Export** and choose a folder inside your Unity project's `Assets/`. Claude can do the same with the `export` tool once you have exported there once.
2. Unity imports each texture with settings taken from the sidecar: sRGB for color and linear for masks, alpha is transparency for straight alpha, clamp wrap for sheets, mipmaps on, max size to fit.
3. Select the sheet and choose **Assets › VFXForge › Create Particle System**. A Particle System appears in the scene with Texture Sheet Animation set to the sheet's tiles and speed, and a material next to the texture.

For a Particle System you already have, open **Window › VFXForge › Particle Sheet Setup**, pick the system and the sheet, optionally a material on your own shader, and press Apply.

Import settings are applied the first time a texture is seen, so what you change in Unity afterwards stays. **Assets › VFXForge › Reapply Import Settings** applies them again.

## Notes

- Without a material of your own, the package uses URP's *Particles/Unlit* when the project has URP, otherwise the built-in *Legacy Shaders/Particles/Alpha Blended*.
- A sheet whose last tiles are empty plays by lifetime instead of by fps, so its speed follows the particle's lifetime at the moment you press Apply.
