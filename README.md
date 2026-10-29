# TaskFlow — Collaborative Project Management

A full-stack project/task workspace starter built with React + Vite, Express, Prisma, SQLite (easy local setup), and Socket.IO. It includes real persistence and working authentication, project/task CRUD, task status changes, comments, dashboard metrics, and live refresh events.

> **Scope note:** This ZIP is a runnable foundation with core workflows, not a claim that every advanced feature in the original specification (email delivery, password-reset email provider, file storage, complete role matrix, or production deployment hardening) is finished. Those integrations require service credentials and additional QA.

## Requirements
- Node.js 20+ (Node 22 LTS recommended)
- npm 10+
- No separate database install required for local development (SQLite).
- PostgreSQL is recommended for deployment; see “PostgreSQL”.

## Run locally (Windows PowerShell)
1. create folder
2. Open a terminal in the `TaskFlow`
3. Install dependencies:
   ```powershell
   npm install
   ```
4. Configure the server:
   ```powershell
   Copy-Item .env.example server/.env
   ```
   Change `SESSION_SECRET` to a long random value.
5. Create the database tables and seed a sample account:
   ```powershell
   npm run db:push
   npm run db:seed
   ```
6. Start both apps:
   ```powershell
   npm run dev
   ```
7. Open `http://localhost:5173`.

Seed account:
- Email: `demo@taskflow.local`
- Password: `TaskFlowDemo123!`

Change the demo password after signing in. Seed data is for local development only.

## Scripts
- `npm run dev` — API and frontend
- `npm run build` — production frontend build
- `npm run db:push` — create/update local schema
- `npm run db:seed` — create demo user, project and tasks

## Environment
`server/.env`:
- `DATABASE_URL` — Prisma connection string
- `SESSION_SECRET` — required secret for signing session tokens
- `CLIENT_ORIGIN` — frontend origin
- `PORT` — API port (default 4000)

The frontend uses Vite's `/api` proxy in development. For a separate production frontend host, configure the API origin and cookie/CORS settings for your deployment.

## API overview
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET/POST /api/projects`
- `GET/PATCH/DELETE /api/projects/:id`
- `GET/POST /api/projects/:id/tasks`
- `PATCH/DELETE /api/tasks/:id`
- `GET/POST /api/tasks/:id/comments`
- `GET /api/dashboard`
- `GET /api/notifications`
- `PATCH /api/notifications/read-all`

All project/task routes require a valid signed session cookie and verify project membership. API errors return JSON with a useful message.

## PostgreSQL
The included schema is configured for SQLite so the app runs without an external service. For PostgreSQL deployment, change `provider = "sqlite"` to `provider = "postgresql"` in `server/prisma/schema.prisma`, set `DATABASE_URL` to your PostgreSQL connection string, then run `npm run db:push`. Review Prisma's provider-specific migration guidance before production use.

## Production checklist
Before public deployment: use PostgreSQL, set HTTPS and secure cookie settings, add CSRF protection appropriate to your hosting topology, configure email delivery for password reset/invitations, add object storage for attachments, set up backups and monitoring, and run the test suite against your deployed services.
