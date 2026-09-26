import { useEffect, useState } from "react";

import {
  getTCloudTheme,
  setTCloudTheme,
  type TCloudThemePreference,
} from "../../services/tcloudTheme";

const values: Array<{
  value: TCloudThemePreference;
  label: string;
}> = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

export function TCloudThemeSetting() {
  const [current, setCurrent] =
    useState<TCloudThemePreference>("system");

  useEffect(() => {
    setCurrent(getTCloudTheme());
  }, []);

  return (
    <section className="tc-settings-theme-card">
      <div>
        <strong>Tema</strong>
        <p>Escolha a aparência do TCloud.</p>
      </div>

      <div className="tc-theme-setting">
        {values.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={current === item.value}
            onClick={() => {
              setCurrent(item.value);
              setTCloudTheme(item.value);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}