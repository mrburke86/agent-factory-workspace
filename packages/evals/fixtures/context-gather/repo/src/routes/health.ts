import { healthController } from "../controllers/health-controller";

export const healthRoute = {
  path: "/health",
  method: "GET",
  handler: healthController,
};
