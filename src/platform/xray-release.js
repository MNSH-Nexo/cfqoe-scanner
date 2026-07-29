const ASSETS = Object.freeze({
  win32: Object.freeze({
    x64: 'Xray-windows-64.zip',
    arm64: 'Xray-windows-arm64-v8a.zip',
  }),
  linux: Object.freeze({
    x64: 'Xray-linux-64.zip',
    arm64: 'Xray-linux-arm64-v8a.zip',
  }),
  android: Object.freeze({
    x64: 'Xray-android-amd64.zip',
    arm64: 'Xray-android-arm64-v8a.zip',
  }),
});

export function xrayAssetName(platform = process.platform, arch = process.arch) {
  const byPlatform = ASSETS[platform];
  if (!byPlatform) {
    throw new Error(
      `Unsupported platform: ${platform}. Supported platforms: Windows, Linux, Android/Termux.`,
    );
  }

  const assetName = byPlatform[arch];
  if (!assetName) {
    throw new Error(
      `Unsupported architecture: ${platform}/${arch}. Supported architectures: x64, arm64.`,
    );
  }

  return assetName;
}
