const DEVICE_TOKEN_KEY = "tcloud.account.deviceToken.v1";

/** Returns only the current user's device session; administrative tokens never
 * belong in a distributed desktop client. */
export function getTCloudDeviceAccessToken(): string | null {
  const value = window.localStorage.getItem(DEVICE_TOKEN_KEY)?.trim();
  return value || null;
}
