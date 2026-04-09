import { Router, type IRouter } from "express";
import { ListDriveFoldersQueryParams, ListDriveFilesQueryParams } from "@workspace/api-zod";
import { listFolders, listVideoFiles } from "../../lib/google-drive";

const router: IRouter = Router();

router.get("/drive/folders", async (req, res): Promise<void> => {
  const params = ListDriveFoldersQueryParams.safeParse(req.query);
  const parentId = params.success ? params.data.parentId : undefined;
  const folders = await listFolders(parentId ?? undefined);
  res.json(folders);
});

router.get("/drive/files", async (req, res): Promise<void> => {
  const params = ListDriveFilesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const files = await listVideoFiles(params.data.folderId);
  res.json(files);
});

export default router;
