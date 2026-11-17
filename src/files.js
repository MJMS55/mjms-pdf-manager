import { registerFileAction, Permission } from "@nextcloud/files";
import { generateUrl } from "@nextcloud/router";
import { createManagerAction } from "./file-action.js";
registerFileAction(
  createManagerAction({
    generateUrl,
    readPermission: Permission.READ,
    navigate: (url) => window.location.assign(url),
  }),
);
