import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videosRouter from "./videos";
import driveRouter from "./drive";
import searchRouter from "./search";
import processingRouter from "./processing";
import foldersRouter from "./folders";
import framesRouter from "./frames";
import transcriptionsRouter from "./transcriptions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(videosRouter);
router.use(driveRouter);
router.use(searchRouter);
router.use(processingRouter);
router.use(foldersRouter);
router.use(framesRouter);
router.use(transcriptionsRouter);

export default router;
