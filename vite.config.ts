import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }
import { createAppDataMiddleware } from './server/app-data'

const RC_ADDR = '127.0.0.1'
const RC_PORT = '5572'
const RC_USER = 'dev'
const RC_PASS = 'dev'
const RC_URL = `http://${RC_ADDR}:${RC_PORT}`
function envList(value: string | undefined) {
    return value
        ? value
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean)
        : []
}

const allowedHosts = [...new Set(envList(process.env.RCLONE_WEB_ALLOWED_HOSTS))]

function devRclone(): import('vite').Plugin {
    let rclone: ChildProcess | null = null
    return {
        name: 'dev-rclone',
        apply: 'serve',
        configureServer(server) {
            const bin = process.env.RCLONE_BIN ?? 'rclone'
            const origin =
                process.env.RCLONE_WEB_PUBLIC_ORIGIN ??
                `http://localhost:${server.config.server.port ?? 5173}`

            rclone = spawn(
                bin,
                [
                    'rcd',
                    '--rc-addr',
                    `${RC_ADDR}:${RC_PORT}`,
                    '--rc-user',
                    RC_USER,
                    '--rc-pass',
                    RC_PASS,
                    '--rc-allow-origin',
                    origin,
                ],
                { stdio: 'ignore' }
            )

            rclone.on('error', (err) => {
                server.config.logger.error(`[rclone] ${err.message}`)
            })

            server.httpServer?.on('close', () => {
                rclone?.kill()
            })

            const original = server.printUrls
            server.printUrls = () => {
                original()
                const base = server.resolvedUrls?.local[0]
                if (base) {
                    const url = `${base}login?url=${RC_URL}&user=${RC_USER}&pass=${RC_PASS}`
                    server.config.logger.info(
                        `  \x1b[32m➜\x1b[0m  \x1b[1mLogin:\x1b[0m   \x1b[36m${url}\x1b[0m`
                    )
                }
            }
        },
        buildEnd() {
            rclone?.kill()
            rclone = null
        },
    }
}

function appDataApi(): import('vite').Plugin {
    return {
        name: 'app-data-api',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(createAppDataMiddleware(server.config.logger))
        },
    }
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss(), appDataApi(), devRclone()],
    define: {
        APP_VERSION: JSON.stringify(pkg.version),
    },
    server: allowedHosts.length > 0 ? { allowedHosts } : undefined,
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        chunkSizeWarningLimit: 1000,
    },
})
