import { buildHealthPayload } from "../services/health-service";

export function healthController() {
  return buildHealthPayload();
}
