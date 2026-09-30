import type { Response } from 'express';

interface SSEClient {
  id: string;
  res: Response;
}

const clients: SSEClient[] = [];

export function addSSEClient(id: string, res: Response) {
  clients.push({ id, res });
  console.log(`[SSE] Client connected: ${id}. Active admin listeners: ${clients.length}`);

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'connected', id })}\n\n`);
}

export function removeSSEClient(id: string) {
  const index = clients.findIndex((c) => c.id === id);
  if (index !== -1) {
    clients.splice(index, 1);
    console.log(`[SSE] Client disconnected: ${id}. Active admin listeners: ${clients.length}`);
  }
}

export function broadcastAttendanceUpdate(data: {
  studentId: string;
  studentName: string;
  action: 'IN' | 'OUT';
  timestamp: string;
  dateKey: string;
  location?: { latitude: number; longitude: number; accuracy: number | null } | null;
}) {
  if (clients.length === 0) return;

  const payload = JSON.stringify({
    type: 'attendance_update',
    ...data,
  });

  for (const client of clients) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (err) {
      console.error('[SSE] Failed to write to client', err);
    }
  }
}
