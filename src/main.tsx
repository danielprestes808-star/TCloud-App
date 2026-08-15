import React from "react";
import ReactDOM from "react-dom/client";

type BootWindow = Window & { __TCLOUD_BOOT_OK__?: boolean };

function formatBootError(reason: unknown): string {
  if (reason instanceof Error) return reason.stack || reason.message;
  if (typeof reason === "string") return reason;
  try { return JSON.stringify(reason); } catch { return String(reason); }
}

function showBootFailure(reason: unknown) {
  const detail = formatBootError(reason);
  console.error("[TCloud] frontend startup failed:", detail);
  const fallback = document.getElementById("tcloud-boot-fallback");
  if (fallback) {
    fallback.classList.add("tcloud-boot-failed");
    const title = fallback.querySelector<HTMLElement>("[data-boot-title]");
    const message = fallback.querySelector<HTMLElement>("[data-boot-message]");
    const technical = fallback.querySelector<HTMLElement>("[data-boot-detail]");
    if (title) title.textContent = "O TCloud não conseguiu carregar a interface";
    if (message) message.textContent = "O aplicativo continua aberto. Recarregue a janela; se o problema continuar, envie o detalhe abaixo.";
    if (technical) technical.textContent = detail;
  }
}

window.onerror = function (message, source, lineno, colno, error) {
  console.error("Global JS Error:", message, "at", source, `${lineno}:${colno}`, error?.stack || error);
  if (!(window as BootWindow).__TCLOUD_BOOT_OK__) showBootFailure(error || String(message));
  return false;
};

window.addEventListener("unhandledrejection", function (event) {
  console.error("Unhandled Promise Rejection:", event.reason, event.reason?.stack || event.reason);
  if (!(window as BootWindow).__TCLOUD_BOOT_OK__) showBootFailure(event.reason);
});

async function boot() {
  try {
    // Install the lightweight resume guard before React starts. It prevents work
    // accumulated while the WebView is hidden/minimized from competing with the
    // first frame when the user returns to TCloud.
    const resumeModule = await import("./services/tcloudWindowResume");
    resumeModule.installTCloudWindowResumeController();

    // Keep these imports after the handlers above. A module-initialization error
    // can otherwise happen before our diagnostics exist, producing only a dark
    // WebView with no useful error message.
    const [, appModule] = await Promise.all([import("./i18n"), import("./App")]);
    const App = appModule.default;
    const rootElement = document.getElementById("root");
    if (!rootElement) throw new Error("Elemento #root não encontrado.");

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );

    (window as BootWindow).__TCLOUD_BOOT_OK__ = true;
    window.requestAnimationFrame(() => {
      document.getElementById("tcloud-boot-fallback")?.remove();
    });
  } catch (error) {
    showBootFailure(error);
  }
}

void boot();
