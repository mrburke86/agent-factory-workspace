import { healthRoute } from "./health";
import { statusRoute } from "./status";

export function registerRoutes() {
  return [healthRoute, statusRoute];
}
