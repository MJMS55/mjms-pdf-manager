import { t } from "./l10n.js";
export function createManagerAction({ generateUrl, navigate, readPermission }) {
  const eligible = (node) =>
    node?.mime === "application/pdf" &&
    Number.isSafeInteger(node.fileid) &&
    node.fileid > 0 &&
    (node.permissions & readPermission) !== 0;
  return {
    id: "mjms-pdf-manager-open",
    displayName: () => t("Open in MJMS-PDF-Manager"),
    iconSvgInline: () =>
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M6 2h8l5 5v5h-2V8h-4V4H6v16h5v2H4V2zm14 11 2 2-7 7h-3v-3z"/></svg>',
    enabled: ({ nodes }) => nodes.length === 1 && eligible(nodes[0]),
    exec: async ({ nodes }) => {
      if (nodes.length !== 1 || !eligible(nodes[0])) return false;
      navigate(
        generateUrl("/apps/mjms_pdf_manager/") + "?fileId=" + nodes[0].fileid,
      );
      return null;
    },
    order: 25,
  };
}
