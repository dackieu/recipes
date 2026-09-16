import { Request, Response, NextFunction } from "express"
import { sendMailDirect } from "../services/email.service"
import { EmailJobPayload } from "../types/email.type"

export const handleQStashMailWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const payload: EmailJobPayload = req.body
    await sendMailDirect(payload)

    return res.status(200).json({
      success: true,
      message: "Email sent successfully",
    })
  } catch (error) {
    // When error is forwarded to error handler, server returns 5xx status,
    // which triggers Upstash QStash automatic retry with exponential backoff.
    next(error)
  }
}

export const webhookController = {
  handleQStashMailWebhook,
}

export default webhookController
