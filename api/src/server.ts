import "dotenv/config"
import app from "./app"
import { pool } from "./config/db"
import { initViewCountSyncJob } from "./jobs/syncViewCounts.job"

const PORT = process.env.PORT || 3000

const startServer = async () => {
  try {
    const res = await pool.query("SELECT NOW()")
    console.log(" Connected to PostgreSQL at:", res.rows[0].now)

    // Initialize background cron jobs
    initViewCountSyncJob()

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`)
    })

    // HTTP Server Timeouts to defend against Slowloris / slow body drip attacks
    server.headersTimeout = 20 * 1000 // 20 seconds
    server.requestTimeout = 30 * 1000 // 30 seconds
    server.keepAliveTimeout = 5 * 1000 // 5 seconds
  } catch (error) {
    console.error("❌ Failed to connect to the database:", error)
    process.exit(1)
  }
}

startServer()

