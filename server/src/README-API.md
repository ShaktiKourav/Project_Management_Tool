# TaskFlow API notes

The API runs on port 4000 by default. JSON responses use `{ data }` wrappers for collection endpoints and `{ error }` for errors.

## Authentication
Session is an HTTP-only cookie named `taskflow_session`. Passwords are hashed with bcrypt. The browser cannot read the cookie.

## Core routes
- `GET /api/health`
- `POST /api/auth/register` — `{ name, email, password }`
- `POST /api/auth/login` — `{ email, password }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/auth/profile` — `{ name, jobTitle }`
- `GET /api/projects`
- `POST /api/projects` — `{ name, description?, color? }`
- `GET /api/projects/:id`
- `PATCH /api/projects/:id`
- `DELETE /api/projects/:id`
- `POST /api/projects/:id/tasks`
- `PATCH /api/tasks/:id`
- `DELETE /api/tasks/:id`
- `POST /api/tasks/:id/comments`
- `GET /api/dashboard`
- `GET /api/notifications`
- `PATCH /api/notifications/read-all`

Protected routes require the session cookie. A project member check is applied before reading or mutating project tasks.
