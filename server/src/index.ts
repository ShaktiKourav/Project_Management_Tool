import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 24) {
  console.warn('SESSION_SECRET is missing or shorter than 24 characters. Set it in server/.env before use.');
}
const JWT_SECRET = secret || 'local-development-secret-change-this-now';
const io = new Server(server, { cors: { origin, credentials: true } });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

type AuthedRequest = Request & { userId?: string };
const tokenFor = (id: string) => jwt.sign({ sub: id }, JWT_SECRET, { expiresIn: '7d' });
function setSession(res: Response, id: string) {
  res.cookie('taskflow_session', tokenFor(id), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000, path: '/' });
}
const auth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.taskflow_session;
    if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    req.userId = payload.sub;
    next();
  } catch { return res.status(401).json({ error: 'Session expired. Please sign in again.' }); }
};
const asyncRoute = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req as AuthedRequest, res)).catch(next);

const projectInclude = { members: { include: { user: { select: { id: true, name: true, email: true, jobTitle: true } } } }, tasks: { include: { assignees: { include: { user: { select: { id: true, name: true, email: true } } } }, comments: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } } }, orderBy: { position: 'asc' as const } } };
async function canAccessProject(projectId: string, userId: string) {
  return !!(await prisma.projectMember.findUnique({ where: { userId_projectId: { userId, projectId } } }));
}
async function taskAccess(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, projectId: true } });
  if (!task || !(await canAccessProject(task.projectId, userId))) return null;
  return task;
}
io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const sessionCookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('taskflow_session='));
    const cookieToken = sessionCookie ? decodeURIComponent(sessionCookie.slice('taskflow_session='.length)) : undefined;
    const raw = socket.handshake.auth?.token || cookieToken;
    if (!raw) return next(new Error('Authentication required'));
    const payload = jwt.verify(raw, JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub) return next(new Error('Invalid session'));
    (socket.data as { userId?: string }).userId = payload.sub;
    next();
  } catch { next(new Error('Invalid session')); }
});
io.on('connection', socket => {
  socket.on('project:join', async (projectId: string) => {
    const userId = socket.data.userId as string;
    if (typeof projectId === 'string' && await canAccessProject(projectId, userId)) socket.join(`project:${projectId}`);
  });
});
function emitProject(projectId: string, event: string, data: unknown) { io.to(`project:${projectId}`).emit(event, data); }

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const schema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().max(254), password: z.string().min(10).max(128) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration details.' });
  const email = parsed.data.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return res.status(409).json({ error: 'An account with this email already exists.' });
  const user = await prisma.user.create({ data: { name: parsed.data.name, email, passwordHash: await bcrypt.hash(parsed.data.password, 12) } });
  const project = await prisma.project.create({ data: { name: 'My first project', description: 'A place to organize your work.', members: { create: { userId: user.id, role: 'OWNER' } } } });
  setSession(res, user.id);
  return res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, jobTitle: user.jobTitle }, projectId: project.id });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  setSession(res, user.id);
  return res.json({ user: { id: user.id, name: user.name, email: user.email, jobTitle: user.jobTitle } });
}));
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('taskflow_session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', auth, asyncRoute(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true, jobTitle: true, createdAt: true } });
  if (!user) return res.status(401).json({ error: 'Account not found.' });
  return res.json({ user });
}));
app.patch('/api/auth/profile', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(80), jobTitle: z.string().trim().max(80).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please check your profile details.' });
  const user = await prisma.user.update({ where: { id: req.userId }, data: parsed.data, select: { id: true, name: true, email: true, jobTitle: true } });
  return res.json({ user });
}));
app.get('/api/projects', auth, asyncRoute(async (req, res) => {
  const projects = await prisma.project.findMany({ where: { archived: false, members: { some: { userId: req.userId } } }, include: projectInclude, orderBy: { updatedAt: 'desc' } });
  return res.json({ projects });
}));
app.post('/api/projects', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(100), description: z.string().max(1000).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Project name must be 2–100 characters.' });
  const project = await prisma.project.create({ data: { ...parsed.data, members: { create: { userId: req.userId!, role: 'OWNER' } } }, include: projectInclude });
  return res.status(201).json({ project });
}));
app.get('/api/projects/:id', auth, asyncRoute(async (req, res) => {
  if (!(await canAccessProject(req.params.id, req.userId!))) return res.status(404).json({ error: 'Project not found.' });
  const project = await prisma.project.findUnique({ where: { id: req.params.id }, include: projectInclude });
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  return res.json({ project });
}));
app.patch('/api/projects/:id', auth, asyncRoute(async (req, res) => {
  const member = await prisma.projectMember.findUnique({ where: { userId_projectId: { userId: req.userId!, projectId: req.params.id } } });
  if (!member || !['OWNER', 'ADMIN'].includes(member.role)) return res.status(403).json({ error: 'Only project owners and admins can edit this project.' });
  const parsed = z.object({ name: z.string().trim().min(2).max(100).optional(), description: z.string().max(1000).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), archived: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid project details.' });
  const project = await prisma.project.update({ where: { id: req.params.id }, data: parsed.data, include: projectInclude });
  return res.json({ project });
}));
app.delete('/api/projects/:id', auth, asyncRoute(async (req, res) => {
  const member = await prisma.projectMember.findUnique({ where: { userId_projectId: { userId: req.userId!, projectId: req.params.id } } });
  if (!member || member.role !== 'OWNER') return res.status(403).json({ error: 'Only the project owner can delete this project.' });
  await prisma.project.delete({ where: { id: req.params.id } });
  return res.json({ ok: true });
}));
app.post('/api/projects/:id/tasks', auth, asyncRoute(async (req, res) => {
  if (!(await canAccessProject(req.params.id, req.userId!))) return res.status(404).json({ error: 'Project not found.' });
  const parsed = z.object({ title: z.string().trim().min(2).max(160), description: z.string().max(4000).optional(), status: z.enum(['BACKLOG','TODO','IN_PROGRESS','IN_REVIEW','DONE']).optional(), priority: z.enum(['LOW','MEDIUM','HIGH','URGENT']).optional(), dueDate: z.string().datetime().optional().nullable() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Check the task title, status, priority, or due date.' });
  const task = await prisma.task.create({ data: { ...parsed.data, dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null, projectId: req.params.id, creatorId: req.userId! }, include: { assignees: { include: { user: { select: { id: true, name: true, email: true } } } }, comments: { include: { user: { select: { id: true, name: true } } } } } });
  emitProject(req.params.id, 'task:created', { taskId: task.id });
  return res.status(201).json({ task });
}));
app.patch('/api/tasks/:id', auth, asyncRoute(async (req, res) => {
  const task = await taskAccess(req.params.id, req.userId!);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const parsed = z.object({ title: z.string().trim().min(2).max(160).optional(), description: z.string().max(4000).optional(), status: z.enum(['BACKLOG','TODO','IN_PROGRESS','IN_REVIEW','DONE']).optional(), priority: z.enum(['LOW','MEDIUM','HIGH','URGENT']).optional(), dueDate: z.string().datetime().nullable().optional(), position: z.number().int().min(0).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid task update.' });
  const data = { ...parsed.data, ...(parsed.data.dueDate !== undefined ? { dueDate: parsed.data.dueDate ? new Date(parsed.data.dueDate) : null } : {}) };
  const updated = await prisma.task.update({ where: { id: task.id }, data, include: { assignees: { include: { user: { select: { id: true, name: true, email: true } } } }, comments: { include: { user: { select: { id: true, name: true } } } } } });
  emitProject(task.projectId, 'task:updated', { taskId: task.id });
  return res.json({ task: updated });
}));
app.delete('/api/tasks/:id', auth, asyncRoute(async (req, res) => {
  const task = await taskAccess(req.params.id, req.userId!);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  await prisma.task.delete({ where: { id: task.id } });
  emitProject(task.projectId, 'task:deleted', { taskId: task.id });
  return res.json({ ok: true });
}));
app.post('/api/tasks/:id/comments', auth, asyncRoute(async (req, res) => {
  const task = await taskAccess(req.params.id, req.userId!);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  const parsed = z.object({ body: z.string().trim().min(1).max(2000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Comment must contain 1–2000 characters.' });
  const comment = await prisma.comment.create({ data: { body: parsed.data.body, taskId: task.id, userId: req.userId! }, include: { user: { select: { id: true, name: true } } } });
  emitProject(task.projectId, 'comment:created', { taskId: task.id });
  return res.status(201).json({ comment });
}));
app.get('/api/dashboard', auth, asyncRoute(async (req, res) => {
  const projects = await prisma.project.findMany({ where: { archived: false, members: { some: { userId: req.userId } } }, include: { tasks: true } });
  const tasks = projects.flatMap(p => p.tasks);
  const now = new Date(); const soon = new Date(Date.now() + 7 * 86400000);
  return res.json({ stats: {
    activeProjects: projects.length, totalTasks: tasks.length,
    myTasks: (await prisma.taskAssignee.count({ where: { userId: req.userId } })),
    completed: tasks.filter(t => t.status === 'DONE').length,
    overdue: tasks.filter(t => t.dueDate && t.dueDate < now && t.status !== 'DONE').length,
    dueSoon: tasks.filter(t => t.dueDate && t.dueDate >= now && t.dueDate <= soon && t.status !== 'DONE').length
  }, projects: projects.map(p => ({ id: p.id, name: p.name, color: p.color, taskCount: p.tasks.length, completed: p.tasks.filter(t => t.status === 'DONE').length })) });
}));
app.get('/api/notifications', auth, asyncRoute(async (req, res) => {
  const notifications = await prisma.notification.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return res.json({ notifications });
}));
app.patch('/api/notifications/read-all', auth, asyncRoute(async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.userId, read: false }, data: { read: true } });
  return res.json({ ok: true });
}));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('API error:', err instanceof Error ? err.message : 'Unknown error');
  res.status(500).json({ error: 'Something went wrong. Please retry.' });
});
const port = Number(process.env.PORT || 4000);
server.listen(port, () => console.log(`TaskFlow API listening at http://localhost:${port}`));
process.on('SIGINT', async () => { await prisma.$disconnect(); server.close(() => process.exit(0)); });
