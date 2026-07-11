export function shouldResetRunPanels(
  nextSessionId: number | null,
  selfPersistedSessionId: number | null,
): boolean {
  return selfPersistedSessionId === null || nextSessionId !== selfPersistedSessionId;
}
