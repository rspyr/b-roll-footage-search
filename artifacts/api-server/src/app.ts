import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const isProduction = process.env.NODE_ENV === "production";

const app: Express = express();

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors(
    isProduction
      ? {
          origin: corsOrigin || false,
          credentials: true,
        }
      : {},
  ),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/frames", express.static(path.join(process.cwd(), "data", "frames")));

app.use("/api", router);

export default app;
