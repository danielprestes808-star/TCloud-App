export type TCloudThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "tcloud-theme";

function resolved(preference: TCloudThemePreference) {
  if (preference !== "system") return preference;

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getTCloudTheme(): TCloudThemePreference {
  const value = localStorage.getItem(STORAGE_KEY);

  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function setTCloudTheme(preference: TCloudThemePreference) {
  localStorage.setItem(STORAGE_KEY, preference);
  document.documentElement.dataset.tcloudTheme = resolved(preference);
  document.documentElement.dataset.tcloudThemePreference = preference;
  window.dispatchEvent(new CustomEvent("tcloud-theme-changed"));
}

export function applyTCloudTheme() {
  const preference = getTCloudTheme();
  document.documentElement.dataset.tcloudTheme = resolved(preference);
  document.documentElement.dataset.tcloudThemePreference = preference;
}