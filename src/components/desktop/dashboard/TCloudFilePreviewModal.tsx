import { useEffect, useMemo, useRef, useState } from "react";
import { File, Loader2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { isAudioFile, isImageFile, isPdfFile, isVideoFile } from "../../../utils";
import { prepareTCloudPreview, tcloudLocalFileUrl, type TCloudPreviewInfo } from "../../../services/tcloudPreview";
import type { TCloudRecentFile } from "../../../services/tcloudDashboard";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface Props {
  file: TCloudRecentFile;
  onClose: () => void;
}

export function TCloudFilePreviewModal({ file, onClose }: Props) {
  const [info, setInfo] = useState<TCloudPreviewInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const kind = useMemo(() => {
    if (isImageFile(file.name)) return "image";
    if (isVideoFile(file.name)) return "video";
    if (isAudioFile(file.name)) return "audio";
    if (isPdfFile(file.name)) return "pdf";
    return "file";
  }, [file.name]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const next = await prepareTCloudPreview(file.id);
        if (disposed) return;
        setInfo(next);
        setError(null);
        if (!next.ready && next.queued) {
          timer = window.setTimeout(() => void poll(), 1400);
        }
      } catch (err) {
        if (!disposed) setError(String(err));
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [file.id]);

  const url = info?.ready && info.local_path ? tcloudLocalFileUrl(info.local_path) : null;

  useEffect(() => {
    if (kind !== "pdf" || !url) {
      setPdf(null);
      return;
    }
    let cancelled = false;
    const task = pdfjsLib.getDocument({ url });
    task.promise.then((doc) => {
      if (cancelled) { void doc.cleanup(); return; }
      setPdf(doc);
    }).catch((err) => {
      if (!cancelled) setError(`Falha ao abrir PDF: ${String(err)}`);
    });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [kind, url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;
    pdf.getPage(1).then(async (page) => {
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport, canvas }).promise;
    }).catch((err) => setError(`Falha ao renderizar PDF: ${String(err)}`));
    return () => { cancelled = true; };
  }, [pdf]);

  const openExternally = async () => {
    if (!info?.local_path) return;
    await invoke("cmd_open_file_externally", { path: info.local_path });
  };

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-app-border-subtle px-5 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold text-app-text">{file.name}</div>
            <div className="truncate text-xs text-app-text-tertiary">{file.path}</div>
          </div>
          <button className="quiet-control flex h-9 w-9 items-center justify-center rounded-lg" onClick={onClose}><X className="h-4 w-4" /></button>
        </header>

        <div className="flex min-h-[420px] flex-1 items-center justify-center overflow-auto bg-black/35 p-5">
          {error ? (
            <div className="max-w-lg rounded-xl border border-app-danger/30 bg-app-danger/10 p-4 text-app-danger">{error}</div>
          ) : !info?.ready || !url ? (
            <div className="flex flex-col items-center gap-3 text-center text-app-text-secondary">
              <Loader2 className="h-8 w-8 animate-spin text-app-accent" />
              <strong className="text-app-text">Preparando pré-visualização…</strong>
              <span className="max-w-md text-sm">{info?.message ?? "Localizando o arquivo…"}</span>
            </div>
          ) : kind === "image" ? (
            <img src={url} alt={file.name} className="max-h-[76vh] max-w-full object-contain" />
          ) : kind === "video" ? (
            <video src={url} controls autoPlay className="max-h-[76vh] max-w-full" />
          ) : kind === "audio" ? (
            <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-black/40 p-8 text-center text-white">
              <div className="mb-5 text-lg font-medium">{file.name}</div>
              <audio src={url} controls autoPlay className="w-full" />
            </div>
          ) : kind === "pdf" ? (
            <div className="flex flex-col items-center gap-3">
              {!pdf && <Loader2 className="h-7 w-7 animate-spin text-white" />}
              <canvas ref={canvasRef} className="max-w-full rounded-lg bg-white shadow-xl" />
              {pdf && <span className="text-xs text-white/70">Prévia da página 1 · {pdf.numPages} página(s)</span>}
            </div>
          ) : (
            <div className="text-center text-app-text-secondary">
              <File className="mx-auto mb-4 h-14 w-14 text-app-accent" />
              <p>Pré-visualização interna não disponível para este formato.</p>
            </div>
          )}
        </div>

        {info?.ready && info.local_path && (
          <footer className="flex justify-end border-t border-app-border-subtle px-5 py-3">
            <button className="tcloud-button" onClick={() => void openExternally()}>Abrir externamente</button>
          </footer>
        )}
      </div>
    </div>
  );
}
