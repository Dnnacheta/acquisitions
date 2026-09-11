import { Router } from "express";
import authenticate from "#middleware/auth.middleware.js";
import { overview, resourceHandlers } from "#controllers/crm.controller.js";

const router = Router();
router.use(authenticate);
router.get("/overview", overview);
for (const resource of ["customers", "leads"]) {
  const handlers = resourceHandlers(resource);
  router.get(`/${resource}`, handlers.list);
  router.post(`/${resource}`, handlers.create);
  router.get(`/${resource}/:id`, handlers.get);
  router.patch(`/${resource}/:id`, handlers.update);
  router.delete(`/${resource}/:id`, handlers.delete);
}
export default router;
