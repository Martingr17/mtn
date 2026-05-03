export function spaAssetPath(assetName: string) {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedAssetName = assetName.startsWith("/") ? assetName.slice(1) : assetName;

  return `${normalizedBaseUrl}${normalizedAssetName}`;
}
