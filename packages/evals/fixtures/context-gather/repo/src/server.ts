import { registerRoutes } from "./routes";

export function createServer() {
  return registerRoutes();
}
