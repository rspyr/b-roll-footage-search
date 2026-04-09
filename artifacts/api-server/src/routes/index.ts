import { Router, type IRouter } from "express";
import healthRouter from "./health";
import videosRouter from "./videos";
import driveRouter from "./drive";
import searchRouter from "./search";
import processingRouter from "./processing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(videosRouter);
router.use(driveRouter);
router.use(searchRouter);
router.use(processingRouter);

export default router;
