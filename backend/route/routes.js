import Router from "express";
import {Analyzer }from "../service/Analyzer.js";

const router=Router();

router.get("/analyze",Analyzer);

export default router;