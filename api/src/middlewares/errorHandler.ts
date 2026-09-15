// src/middlewares/errorHandler.ts
import { Request, Response, NextFunction } from "express"
import { AppError } from "../utils/AppError"

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Handle body-parser payload limit exceeded (413 Payload Too Large)
  if ((err as any).type === "entity.too.large" || (err as any).status === 413) {
    return res.status(413).json({
      success: false,
      error: "Dung lượng dữ liệu gửi lên quá lớn (tối đa 10KB).",
    })
  }

  const statusCode =
    err instanceof AppError
      ? err.statusCode
      : (err as any).status || (err as any).statusCode || 500

  const message = err.message || "Internal Server Error"
  const details = err instanceof AppError ? err.details : undefined

  // Log unhandled server errors (5xx) with stack traces to Render console / stdout
  if (statusCode >= 500) {
    console.error(`[${new Date().toISOString()}] [ERROR] ${req.method} ${req.originalUrl}:`, err)
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(details && { details }),
  })
}
