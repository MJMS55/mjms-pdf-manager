/** Translate through Nextcloud, with a source-language fallback for standalone tools. */
export function t(message, parameters = {}) {
  if (globalThis.OC?.L10N?.translate) {
    return globalThis.OC.L10N.translate("mjms_pdf_manager", message, parameters);
  }
  return message.replace(/\{([^}]+)\}/g, (match, key) =>
    Object.hasOwn(parameters, key) ? String(parameters[key]) : match,
  );
}
