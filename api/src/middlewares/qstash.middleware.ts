import { Request, Response, NextFunction } from "express"
import { qstashReceiver } from "../config/qstash"
import { AppError } from "../utils/AppError"

export const verifyQStashSignature = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const signature = (req.headers["upstash-signature"] ||
      req.headers["Upstash-Signature"]) as string | undefined

    // If QStash receiver is not configured (e.g. local dev without signing keys)
    if (!qstashReceiver) {
      if (process.env.NODE_ENV === "production") {
        return next(
          new AppError(
            "QStash signing keys are missing on the server. Webhook cannot be verified.",
            500
          )
        )
      }
      console.warn(
        "⚠️ [QSTASH] Skipping signature verification in non-production environment (signing keys not configured)."
      )
      return next()
    }

    if (!signature) {
      return next(new AppError("Missing Upstash-Signature header", 401))
    }

    const bodyToVerify = req.rawBody || JSON.stringify(req.body)

    const isValid = await qstashReceiver.verify({
      signature,
      body: bodyToVerify,
    })

    if (!isValid) {
      return next(new AppError("Invalid Upstash signature", 401))
    }

    next()
  } catch (error: any) {
    console.error("❌ [QSTASH] Signature verification error:", error)
    return next(new AppError(`Signature verification failed: ${error.message}`, 401))
  }
}
