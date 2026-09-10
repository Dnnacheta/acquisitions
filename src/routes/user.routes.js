import { Router } from "express";
import {
  deleteUser,
  getUserById,
  updateUser,
  createUser,
  listUsers,
} from "#controllers/user.controller.js";
import authenticate from "#middleware/auth.middleware.js";

const userRouter = Router();

userRouter.use(authenticate);
userRouter.post("/", createUser);
userRouter.get("/", listUsers);
userRouter.get("/me", getUserById);
userRouter.get("/:id", getUserById);
userRouter.patch("/:id", updateUser);
userRouter.put("/:id", updateUser);
userRouter.delete("/:id", deleteUser);

export default userRouter;
