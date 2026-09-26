export type CanonicalCoverageSnapshot = {
  active: number;
  mapped: number;
  coveragePercent: number;
  legacyFallbackAllowed: boolean;
};

export function canonicalMode(snapshot: CanonicalCoverageSnapshot) {
  return {
    canonicalFirst: snapshot.mapped > 0,
    legacyFallbackAllowed: snapshot.coveragePercent < 100,
    strictCanonical: snapshot.coveragePercent >= 100,
  };
}

export function assertNoSyntheticRemoteIdentity(
  coreFileId: string | null | undefined,
  telegramChatId: number | null | undefined,
) {
  if (coreFileId?.trim()) return;

  if (
    typeof telegramChatId === "number" &&
    telegramChatId < 0 &&
    telegramChatId > -1_000_000
  ) {
    throw new Error(
      "Identidade local/sintética não pode ser usada como identidade global sem coreFileId.",
    );
  }
}