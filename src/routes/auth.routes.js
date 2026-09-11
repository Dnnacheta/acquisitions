import { Router } from "express";
import { signIn, signOut, signUp } from "#controllers/auth.controller.js";

import {
  forgotPassword,
  resetPassword,
  requestEmailVerification,
  verifyEmail,
} from "#controllers/account.controller.js";

const authRouter = Router();

authRouter.post("/sign-up", signUp);
authRouter.post("/sign-in", signIn);

authRouter.post("/sign-out", signOut);

authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);
authRouter.post("/request-email-verification", requestEmailVerification);
authRouter.post("/verify-email", verifyEmail);

export default authRouter;
