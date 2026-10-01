import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import ServiceRouter from "./route/routes.js";

dotenv.config();

const app = express();
app.use(cors({
    origin: "*",
}));

app.use(express.json());


const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.send("Hello, World!");
});

app.use("/api",ServiceRouter);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});