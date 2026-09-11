import express from "express";
import api from "./src/app.js";

// Vercel discovers this entry point; Docker uses src/index.js instead.
const app = express();
app.use(api);
export default app;
