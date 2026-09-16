import express from "express"
import cookieParser from "cookie-parser"
import helmet from "helmet"
import swaggerUi from "swagger-ui-express"
import router from "./routes"
import { errorHandler } from "./middlewares/errorHandler"
import { getOpenApiDocumentation } from "./docs/openapi"
import { httpLogger, getClientIp } from "./utils/logger"
import rateLimit from "express-rate-limit"

const app = express()

// Trust proxy (trust all proxy hops on Render/Cloudflare so real client IP is resolved)
app.set("trust proxy", true)

// HTTP request logging to stdout (Render console / terminal)
app.use(httpLogger)

// 1. Helmet HTTP Security Hardening (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // allows Swagger UI scripts
        styleSrc: ["'self'", "'unsafe-inline'"], // allows Swagger UI styles
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com", "https:"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }, // permits external frontend & asset loading
  })
)

// 2. Strict CORS Whitelist (Defends against malicious Origin Reflection)
const ALLOWED_ORIGINS = new Set([
  "http://localhost:8888",
  "http://localhost:3000",
  "https://recipes-five-opal.vercel.app",
  "https://bepphuong.online",
  "https://www.bepphuong.online",
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : []),
  ...(process.env.ACCESS_CONTROL_ALLOW_ORIGIN
    ? [process.env.ACCESS_CONTROL_ALLOW_ORIGIN.trim()]
    : []),
])

app.use((req, res, next) => {
  const origin = req.headers.origin

  // Only reflect Allow-Origin if the requesting origin is on our trusted whitelist
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Credentials", "true")
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Refresh-Token, X-Cron-Secret, Upstash-Signature"
  )
  res.setHeader("Access-Control-Max-Age", "86400") // 24h preflight cache

  if (req.method === "OPTIONS") {
    return res.sendStatus(204)
  }
  next()
})

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 phút
  max: 200, // Tối đa 200 requests/IP
  message: "Too many requests from this IP, please try again after 10 minutes",
  keyGenerator: (req) => getClientIp(req),
  skip: (req) => getClientIp(req) === "222.252.30.184",
  validate: { trustProxy: false },
})

app.use(apiLimiter)

// 3. Strict Payload Size Limits (Defends against JSON / URL-encoded body flood DoS)
app.use(
  express.json({
    limit: "10kb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString("utf-8")
    },
  })
)
app.use(express.urlencoded({ extended: true, limit: "10kb" }))
app.use(cookieParser())

app.get("/wake-up", (req, res) => {
  res.json({
    message: "I'm alive",
    commit: process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || "local",
  })
})

// Main API routes
app.use("/api", router)

// Serve OpenAPI Specification JSON and Swagger UI
const openApiDoc = getOpenApiDocumentation()
app.get("/docs.json", (req, res) => {
  res.json(openApiDoc)
})
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDoc))

// Global Error Handler
app.use(errorHandler)

export default app
