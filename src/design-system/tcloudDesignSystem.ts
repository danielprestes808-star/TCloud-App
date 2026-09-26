export const TCLOUD_NAVIGATION = [
  { id: "files", label: "Arquivos", icon: "folder" },
  { id: "recent", label: "Recentes", icon: "history" },
  { id: "favorites", label: "Favoritos", icon: "star" },
  { id: "offline", label: "Disponível offline", icon: "download" },
  { id: "trash", label: "Lixeira", icon: "trash" },
] as const;

export const TCLOUD_PRIMARY_ACTIONS = [
  { id: "newFolder", label: "Nova pasta", icon: "folder-plus" },
  { id: "upload", label: "Enviar", icon: "upload" },
  { id: "newForum", label: "Novo fórum", icon: "messages-square" },
] as const;

export const TCLOUD_SYNC_STATES = {
  online: { label: "Somente online", icon: "cloud" },
  offline: { label: "Disponível neste dispositivo", icon: "circle-check" },
  syncing: { label: "Sincronizando", icon: "refresh-cw" },
  uploading: { label: "Enviando", icon: "upload" },
  downloading: { label: "Baixando", icon: "download" },
  attention: { label: "Precisa de atenção", icon: "triangle-alert" },
  paused: { label: "Pausado", icon: "pause" },
} as const;

export const TCLOUD_LAYOUT = {
  sidebarWidth: 232,
  topbarHeight: 52,
  rowHeight: 44,
  controlHeight: 36,
} as const;