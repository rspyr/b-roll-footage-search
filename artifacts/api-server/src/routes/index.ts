import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import videosRouter from "./videos";
import driveRouter from "./drive";
import searchRouter from "./search";
import processingRouter from "./processing";
import foldersRouter from "./folders";
import framesRouter from "./frames";
import transcriptionsRouter from "./transcriptions";
import annotationsRouter from "./annotations";
import { requireAuth } from "../middleware/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);

router.use(requireAuth);
router.use(videosRouter);
router.use(driveRouter);
router.use(searchRouter);
router.use(processingRouter);
router.use(foldersRouter);
router.use(framesRouter);
router.use(transcriptionsRouter);
router.use(annotationsRouter);

export default router;
