import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { requireAuth } from "./middleware/requireAuth";

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
      : {
          origin: true,
          credentials: true,
        },
  ),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

const PgStore = connectPgSimple(session);

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "session",
      pruneSessionInterval: 60 * 15,
    }),
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: isProduction ? "none" : "lax",
    },
  }),
);

app.use("/api/frames", requireAuth, express.static(path.join(process.cwd(), "data", "frames")));

app.use("/api", router);

export default app;
