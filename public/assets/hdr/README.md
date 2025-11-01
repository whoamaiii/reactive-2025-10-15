Place HDR equirectangular textures here to avoid runtime network fetches.

Suggested filenames (match three.js examples):
- royal_esplanade_1k.hdr
- venice_sunset_1k.hdr
- lebombo_1k.hdr
- moonless_golf_1k.hdr

`src/scene.js` will try `/assets/hdr/<filename>` first, then fall back to the threejs CDN.


