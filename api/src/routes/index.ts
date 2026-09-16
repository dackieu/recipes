import { Router } from "express"
import recipeRouter from "./recipe.router"
import uploadRouter from "./upload.router"
import userRouter from "./user.route"
import { categoryRouter } from "./category.router"
import webhookRouter from "./webhook.router"

const router = Router()
router.use("/recipes", recipeRouter)
router.use("/upload", uploadRouter)
router.use("/users", userRouter)
router.use("/categories", categoryRouter)
router.use("/webhooks", webhookRouter)

export default router
