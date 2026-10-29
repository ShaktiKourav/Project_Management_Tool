import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'demo@taskflow.local';
  const passwordHash = await bcrypt.hash('TaskFlowDemo123!', 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: 'Alex Morgan', email, passwordHash, jobTitle: 'Product Designer' }
  });
  const existing = await prisma.project.findFirst({ where: { name: 'Website Redesign', members: { some: { userId: user.id } } } });
  if (!existing) {
    const project = await prisma.project.create({
      data: {
        name: 'Website Redesign',
        description: 'Refresh the marketing site and improve the product experience.',
        color: '#6d5dfc',
        members: { create: { userId: user.id, role: 'OWNER' } },
        tasks: { create: [
          { title: 'Audit current landing page', description: 'Review the main conversion path and list improvements.', status: 'DONE', priority: 'HIGH', creatorId: user.id, position: 0 },
          { title: 'Create new component library', description: 'Define buttons, cards, forms, and spacing tokens.', status: 'IN_PROGRESS', priority: 'URGENT', creatorId: user.id, position: 0 },
          { title: 'Review mobile navigation', description: 'Check navigation behavior on small screens.', status: 'TODO', priority: 'MEDIUM', creatorId: user.id, position: 0 },
          { title: 'Prepare handoff notes', description: 'Document states and responsive breakpoints.', status: 'BACKLOG', priority: 'LOW', creatorId: user.id, position: 0 }
        ] }
      }
    });
    await prisma.notification.create({ data: { userId: user.id, title: 'Welcome to TaskFlow', body: `Your ${project.name} workspace is ready.` } });
  }
  console.log('Seed complete. Demo login: demo@taskflow.local / TaskFlowDemo123!');
}
main().finally(() => prisma.$disconnect());
